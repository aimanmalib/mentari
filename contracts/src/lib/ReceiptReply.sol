// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/// @title ReceiptReply
/// @notice Reads the receipt id from the Native receipts book's reply to `record`, which is the JSON of the
/// stored receipt (for example `{"id":7,"sender":"qor1…","note":"…","height":123}`).
/// @dev The whole reply is checked as JSON before the id is trusted: one top-level object, the key `id`
/// exactly once at the top level, and its value a plain integer from 1 to 2^64-1. Anything else reverts.
/// Nesting is capped at `MAX_DEPTH` so a hostile reply cannot exhaust gas through recursion.
library ReceiptReply {
    uint256 internal constant MAX_DEPTH = 8;
    bytes1 private constant _CLOSE_OBJECT = 0x7d; // }
    bytes1 private constant _CLOSE_ARRAY = 0x5d; // ]

    /// The reply is not valid JSON, is not an object, or has no single integer `id` from 1 to 2^64-1.
    error BadReply();

    /// The receipt id in `reply`. Reverts with `BadReply` unless the reply is well formed.
    function readId(bytes memory reply) internal pure returns (uint64) {
        uint256 i = _ws(reply, 0);
        if (i >= reply.length || reply[i] != "{") revert BadReply();
        ++i;
        bool seen;
        uint64 id;
        i = _ws(reply, i);
        if (i < reply.length && reply[i] == "}") {
            revert BadReply(); // an empty object has no id
        }
        while (true) {
            uint256 keyStart = i + 1;
            i = _string(reply, i);
            bool isId = i - keyStart == 3 && reply[keyStart] == "i" && reply[keyStart + 1] == "d";
            _plainKey(reply, keyStart, i - 1);
            i = _ws(reply, i);
            if (i >= reply.length || reply[i] != ":") revert BadReply();
            i = _ws(reply, i + 1);
            if (isId) {
                if (seen) revert BadReply();
                seen = true;
                (id, i) = _id(reply, i);
            } else {
                i = _value(reply, i, 1);
            }
            i = _ws(reply, i);
            if (i >= reply.length) revert BadReply();
            if (reply[i] == "}") break;
            if (reply[i] != ",") revert BadReply();
            i = _ws(reply, i + 1);
        }
        if (_ws(reply, i + 1) != reply.length || !seen) revert BadReply();
        return id;
    }

    /// The id value: digits only (no sign, fraction or exponent), no leading zero, 1 to 2^64-1.
    function _id(bytes memory s, uint256 i) private pure returns (uint64, uint256) {
        uint256 start = i;
        uint256 v;
        while (i < s.length && s[i] >= "0" && s[i] <= "9") {
            v = v * 10 + (uint8(s[i]) - 48);
            if (v > type(uint64).max) revert BadReply();
            ++i;
        }
        if (i == start || v == 0 || (s[start] == "0" && i - start > 1)) revert BadReply();
        if (i < s.length && (s[i] == "." || s[i] == "e" || s[i] == "E")) revert BadReply();
        // casting to uint64 is safe because the loop above reverts once v exceeds type(uint64).max
        // forge-lint: disable-next-line(unsafe-typecast)
        return (uint64(v), i);
    }

    function _value(bytes memory s, uint256 i, uint256 depth) private pure returns (uint256) {
        if (i >= s.length || depth > MAX_DEPTH) revert BadReply();
        bytes1 c = s[i];
        if (c == '"') return _string(s, i);
        if (c == "{" || c == "[") return _container(s, i, depth);
        if (c == "-" || (c >= "0" && c <= "9")) return _number(s, i);
        if (c == "t") return _literal(s, i, "true");
        if (c == "f") return _literal(s, i, "false");
        if (c == "n") return _literal(s, i, "null");
        revert BadReply();
    }

    function _container(bytes memory s, uint256 i, uint256 depth) private pure returns (uint256 end) {
        bool isObject = s[i] == "{";
        bytes1 close = isObject ? _CLOSE_OBJECT : _CLOSE_ARRAY;
        i = _ws(s, i + 1);
        if (i < s.length && s[i] == close) return i + 1;
        while (true) {
            if (isObject) {
                i = _ws(s, _string(s, i));
                if (i >= s.length || s[i] != ":") revert BadReply();
                i = _ws(s, i + 1);
            }
            i = _ws(s, _value(s, i, depth + 1));
            if (i >= s.length) revert BadReply();
            if (s[i] == close) return i + 1;
            if (s[i] != ",") revert BadReply();
            i = _ws(s, i + 1);
        }
    }

    /// A JSON string starting at `i` (which must be `"`); returns the index after the closing quote.
    function _string(bytes memory s, uint256 i) private pure returns (uint256) {
        if (i >= s.length || s[i] != '"') revert BadReply();
        for (++i; i < s.length; ++i) {
            bytes1 c = s[i];
            if (c == '"') return i + 1;
            if (c < 0x20) revert BadReply();
            if (c == "\\") {
                if (++i >= s.length) revert BadReply();
                c = s[i];
                if (c == "u") {
                    if (i + 4 >= s.length) revert BadReply();
                    for (uint256 k = 1; k <= 4; ++k) {
                        if (!_isHex(s[i + k])) revert BadReply();
                    }
                    i += 4;
                } else if (
                    c != '"' && c != "\\" && c != "/" && c != "b" && c != "f" && c != "n" && c != "r" && c != "t"
                ) {
                    revert BadReply();
                }
            }
        }
        revert BadReply();
    }

    /// A JSON number: -?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?
    function _number(bytes memory s, uint256 i) private pure returns (uint256) {
        if (s[i] == "-") ++i;
        if (i >= s.length) revert BadReply();
        if (s[i] == "0") ++i;
        else i = _digits(s, i);
        if (i < s.length && s[i] == ".") i = _digits(s, i + 1);
        if (i < s.length && (s[i] == "e" || s[i] == "E")) {
            ++i;
            if (i < s.length && (s[i] == "+" || s[i] == "-")) ++i;
            i = _digits(s, i);
        }
        return i;
    }

    /// One or more digits starting at `i`.
    function _digits(bytes memory s, uint256 i) private pure returns (uint256) {
        uint256 start = i;
        while (i < s.length && s[i] >= "0" && s[i] <= "9") {
            ++i;
        }
        if (i == start) revert BadReply();
        return i;
    }

    function _literal(bytes memory s, uint256 i, bytes memory word) private pure returns (uint256) {
        if (i + word.length > s.length) revert BadReply();
        for (uint256 k; k < word.length; ++k) {
            if (s[i + k] != word[k]) revert BadReply();
        }
        return i + word.length;
    }

    /// Top-level keys may not use escapes, so no spelling of `id` can hide from the duplicate check.
    function _plainKey(bytes memory s, uint256 start, uint256 end) private pure {
        for (uint256 k = start; k < end; ++k) {
            if (s[k] == "\\") revert BadReply();
        }
    }

    function _ws(bytes memory s, uint256 i) private pure returns (uint256) {
        while (i < s.length && (s[i] == " " || s[i] == "\n" || s[i] == "\r" || s[i] == "\t")) {
            ++i;
        }
        return i;
    }

    function _isHex(bytes1 c) private pure returns (bool) {
        return (c >= "0" && c <= "9") || (c >= "a" && c <= "f") || (c >= "A" && c <= "F");
    }
}
