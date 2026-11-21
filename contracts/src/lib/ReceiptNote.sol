// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/// @title ReceiptNote
/// @notice Builds the note that a retirement writes into the Native receipts book, and the JSON message
/// that carries it. The note is built from typed fields only, so it cannot change the shape of the message.
/// @dev The note goes inside a JSON string (`{"record":{"note":"…"}}`). Numbers are decimal digits, the
/// holder is 40 lowercase hex digits, and the free-text memo is limited to `[A-Za-z0-9 .:/#-]`: none of
/// these can produce a quote, a backslash or a control character.
library ReceiptNote {
    /// Longest memo a holder may attach to a retirement.
    uint256 internal constant MAX_MEMO = 40;
    /// Longest note the format can produce: "MTR1 n=" + 20 + " wh=" + 20 + " by=0x" + 40 + " m=" + 40.
    uint256 internal constant MAX_NOTE = 140;

    bytes internal constant _DIGITS = "0123456789abcdef";

    /// The memo is longer than `MAX_MEMO` or holds a character outside `[A-Za-z0-9 .:/#-]`.
    error BadMemo();

    /// True when `memo` is 0 to `MAX_MEMO` characters, each one in `[A-Za-z0-9 .:/#-]`.
    function isValidMemo(string memory memo) internal pure returns (bool) {
        bytes memory b = bytes(memo);
        if (b.length > MAX_MEMO) return false;
        for (uint256 i; i < b.length; ++i) {
            if (!_memoChar(b[i])) return false;
        }
        return true;
    }

    /// The receipt note: `MTR1 n=<n> wh=<wh> by=0x<40 hex> m=<memo>`, at most `MAX_NOTE` characters.
    function note(uint64 n, uint64 wh, address by, string memory memo) internal pure returns (string memory) {
        if (!isValidMemo(memo)) revert BadMemo();
        return string.concat("MTR1 n=", _decimal(n), " wh=", _decimal(wh), " by=", _hex(by), " m=", memo);
    }

    /// The `record` message for the Native receipts book, with `noteText` from `note`.
    function recordPayload(string memory noteText) internal pure returns (bytes memory) {
        return bytes(string.concat('{"record":{"note":"', noteText, '"}}'));
    }

    function _memoChar(bytes1 c) private pure returns (bool) {
        return (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") || c == " " || c == "."
            || c == ":" || c == "/" || c == "#" || c == "-";
    }

    function _decimal(uint256 v) private pure returns (string memory) {
        if (v == 0) return "0";
        uint256 digits;
        for (uint256 t = v; t != 0; t /= 10) {
            ++digits;
        }
        bytes memory out = new bytes(digits);
        for (; v != 0; v /= 10) {
            out[--digits] = _DIGITS[v % 10];
        }
        return string(out);
    }

    function _hex(address a) private pure returns (string memory) {
        bytes memory out = new bytes(42);
        out[0] = "0";
        out[1] = "x";
        uint160 v = uint160(a);
        for (uint256 i = 41; i > 1; --i) {
            out[i] = _DIGITS[v & 15];
            v >>= 4;
        }
        return string(out);
    }
}
