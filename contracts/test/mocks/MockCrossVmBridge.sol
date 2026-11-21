// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/// @title MockCrossVmBridge
/// @notice Test stand-in for the CrossVM bridge at 0x…0901 together with the Native `qday-receipts` book
/// behind it (Foundry's EVM has no QoreChain precompiles). Install it with `vm.etch`, then configure it
/// through the same address. It behaves like the real pair as far as the docs and the workshop describe:
/// - only allowlisted targets are reached, and only VM 1 (Native);
/// - value is refused, and a static call fails because the call writes state;
/// - `{"record":{"note":"…"}}` stores a receipt and replies with the receipt JSON, ABI-encoded as `bytes`;
/// - `{"fail":{}}` and any other message are refused;
/// - modes make the target refuse everything, or make the bridge look inactive (empty reply),
///   or replace the reply with chosen bytes.
contract MockCrossVmBridge {
    enum Mode {
        Normal,
        TargetRefuses,
        Inactive,
        CustomReply
    }

    struct Receipt {
        uint64 id;
        address sender;
        string note;
    }

    Mode public mode;
    bytes public customReply;
    mapping(bytes32 => bool) public allowed;
    uint64 public count;
    mapping(uint64 => Receipt) internal _receipts;
    mapping(address => uint256) public receiptsBy;

    function allow(string calldata target) external {
        allowed[keccak256(bytes(target))] = true;
    }

    function setMode(Mode m) external {
        mode = m;
    }

    function setCustomReply(bytes calldata reply) external {
        mode = Mode.CustomReply;
        customReply = reply;
    }

    function receipt(uint64 id) external view returns (Receipt memory) {
        return _receipts[id];
    }

    function executeCrossVMCall(uint8 vmId, string calldata target, bytes calldata payload)
        external
        payable
        returns (bytes memory)
    {
        if (mode == Mode.Inactive) {
            assembly {
                return(0, 0)
            }
        }
        require(msg.value == 0, "REFUSED by the bridge: value is not accepted");
        require(vmId == 1, "REFUSED by the bridge: unknown target VM");
        require(
            allowed[keccak256(bytes(target))], string.concat("REFUSED by the bridge: ", target, " is not allowlisted")
        );
        if (mode == Mode.TargetRefuses) revert("refused by the Native contract");
        if (keccak256(payload) == keccak256('{"fail":{}}')) revert("refused on purpose by the Native contract");
        string memory note = _note(payload);
        uint64 id = ++count;
        _receipts[id] = Receipt(id, msg.sender, note);
        ++receiptsBy[msg.sender];
        if (mode == Mode.CustomReply) return customReply;
        return bytes(
            string.concat(
                '{"id":',
                _decimal(id),
                ',"sender":"',
                _hex(msg.sender),
                '","note":"',
                note,
                '","height":',
                _decimal(block.number),
                "}"
            )
        );
    }

    /// The note inside `{"record":{"note":"…"}}`; the real contract would reject a malformed message too.
    function _note(bytes calldata p) private pure returns (string memory) {
        bytes memory head = '{"record":{"note":"';
        bytes memory tail = '"}}';
        require(p.length >= head.length + tail.length, "unknown message");
        require(keccak256(p[:head.length]) == keccak256(head), "unknown message");
        require(keccak256(p[p.length - tail.length:]) == keccak256(tail), "unknown message");
        bytes memory n = p[head.length:p.length - tail.length];
        for (uint256 i; i < n.length; ++i) {
            require(n[i] != '"' && n[i] != "\\" && uint8(n[i]) >= 0x20, "unknown message");
        }
        return string(n);
    }

    function _decimal(uint256 v) private pure returns (string memory) {
        if (v == 0) return "0";
        bytes memory out;
        for (; v != 0; v /= 10) {
            out = bytes.concat(bytes1(uint8(48 + (v % 10))), out);
        }
        return string(out);
    }

    function _hex(address a) private pure returns (string memory) {
        bytes memory out = new bytes(40);
        uint160 v = uint160(a);
        for (uint256 i = 40; i > 0; --i) {
            out[i - 1] = bytes("0123456789abcdef")[v & 15];
            v >>= 4;
        }
        return string.concat("0x", string(out));
    }
}
