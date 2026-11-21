// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/// QoreChain post-quantum precompiles (published interface; active on the qorechain-diana testnet).
interface IQorePqc {
    /// ML-DSA-87 (FIPS 204) verification: 2592-byte public key, 4627-byte signature.
    function pqcVerify(bytes calldata pubkey, bytes calldata signature, bytes calldata message)
        external
        view
        returns (bool valid);

    /// The post-quantum key an account registered on chain.
    function pqcKeyStatus(address account)
        external
        view
        returns (bool registered, uint8 algorithmId, bytes memory pubkey, bool possessionProven);
}

/// @title Pqc
/// @notice Reads an account's ML-DSA-87 key from the chain's key registry and checks signatures with it.
/// A key counts only when it is registered, is ML-DSA-87, has the right length and was registered with a
/// proof of possession. Keys are read on every use, so a key the account rotates on chain is picked up.
/// @dev Pattern from the workshop 2 vault (Apache-2.0, credited in NOTICE). Low-level static calls are used
/// so that an inactive precompile (which returns empty data) gives a named error, not a decoding panic.
library Pqc {
    address internal constant VERIFY = 0x0000000000000000000000000000000000000a01;
    address internal constant KEYS = 0x0000000000000000000000000000000000000a02;
    /// `algorithmId` for ML-DSA-87 in the key registry.
    uint8 internal constant ML_DSA_87 = 1;
    uint256 internal constant PUBKEY_LENGTH = 2592;
    uint256 internal constant SIGNATURE_LENGTH = 4627;

    /// A precompile returned no data or failed: it is not active on this chain.
    error PqcUnavailable();
    /// `account` has no registered ML-DSA-87 key of the right length.
    error KeyNotRegistered(address account);
    /// `account` registered a key without a proof of possession.
    error KeyNotProven(address account);
    /// The signature is not 4627 bytes.
    error BadSignatureLength(uint256 length);
    /// The signature does not verify against the account's key and the message.
    error BadSignature(address signer);

    /// True when `account` has a registered, possession-proven ML-DSA-87 key of the right length.
    function isQuantumReady(address account) internal view returns (bool) {
        (bool registered, uint8 algorithmId, bytes memory pubkey, bool proven) = _status(account);
        return registered && proven && algorithmId == ML_DSA_87 && pubkey.length == PUBKEY_LENGTH;
    }

    /// The account's ML-DSA-87 public key. Reverts unless the account is quantum ready.
    function keyOf(address account) internal view returns (bytes memory) {
        (bool registered, uint8 algorithmId, bytes memory pubkey, bool proven) = _status(account);
        if (!registered || algorithmId != ML_DSA_87 || pubkey.length != PUBKEY_LENGTH) {
            revert KeyNotRegistered(account);
        }
        if (!proven) revert KeyNotProven(account);
        return pubkey;
    }

    /// Reverts unless `signature` is a valid ML-DSA-87 signature of `message` by `signer`'s registered key.
    function requireSignature(address signer, bytes memory message, bytes memory signature) internal view {
        if (signature.length != SIGNATURE_LENGTH) revert BadSignatureLength(signature.length);
        bytes memory pubkey = keyOf(signer);
        (bool ok, bytes memory ret) =
            VERIFY.staticcall(abi.encodeCall(IQorePqc.pqcVerify, (pubkey, signature, message)));
        if (!ok || ret.length != 32) revert PqcUnavailable();
        if (!abi.decode(ret, (bool))) revert BadSignature(signer);
    }

    function _status(address account) private view returns (bool, uint8, bytes memory, bool) {
        (bool ok, bytes memory ret) = KEYS.staticcall(abi.encodeCall(IQorePqc.pqcKeyStatus, (account)));
        // Four head words plus the key's length word: anything shorter cannot be a status reply.
        if (!ok || ret.length < 160) revert PqcUnavailable();
        return abi.decode(ret, (bool, uint8, bytes, bool));
    }
}
