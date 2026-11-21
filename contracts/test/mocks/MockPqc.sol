// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/// @title MockPqc
/// @notice Test stand-in for both post-quantum precompiles. Etch it at 0x…0a01 (pqcVerify) and at 0x…0a02
/// (pqcKeyStatus); keys are set on the 0x…0a02 copy. ML-DSA-87 is not computed: a "signature" is valid when
/// it is 4627 bytes long and starts with keccak256(pubkey, message). That keeps tests fast and lets them
/// produce valid and invalid signatures for any key without real key material.
contract MockPqc {
    struct Status {
        bool registered;
        uint8 algorithmId;
        bytes pubkey;
        bool possessionProven;
    }

    mapping(address => Status) internal _status;

    function setKey(address account, bool registered, uint8 algorithmId, bytes calldata pubkey, bool proven) external {
        _status[account] = Status(registered, algorithmId, pubkey, proven);
    }

    function pqcKeyStatus(address account) external view returns (bool, uint8, bytes memory, bool) {
        Status storage s = _status[account];
        return (s.registered, s.algorithmId, s.pubkey, s.possessionProven);
    }

    function pqcVerify(bytes calldata pubkey, bytes calldata signature, bytes calldata message)
        external
        pure
        returns (bool)
    {
        if (pubkey.length != 2592 || signature.length != 4627) return false;
        return bytes32(signature[:32]) == keccak256(abi.encode(pubkey, message));
    }

    /// A signature this mock accepts for `pubkey` and `message`.
    function sign(bytes memory pubkey, bytes memory message) external pure returns (bytes memory sig) {
        sig = new bytes(4627);
        bytes32 h = keccak256(abi.encode(pubkey, message));
        assembly {
            mstore(add(sig, 32), h)
        }
    }
}
