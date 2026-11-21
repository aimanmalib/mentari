// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {CrossVm} from "../../src/lib/CrossVm.sol";
import {ReceiptNote} from "../../src/lib/ReceiptNote.sol";
import {ReceiptReply} from "../../src/lib/ReceiptReply.sol";
import {Pqc} from "../../src/lib/Pqc.sol";

/// Exposes the internal library functions as external calls, so tests can expect their reverts.
contract LibHarness {
    function callNative(string memory target, bytes memory payload) external returns (bytes memory) {
        return CrossVm.callNative(target, payload);
    }

    function unwrapReply(bytes memory ret) external pure returns (bytes memory) {
        return CrossVm.unwrapReply(ret);
    }

    function isValidMemo(string memory memo) external pure returns (bool) {
        return ReceiptNote.isValidMemo(memo);
    }

    function note(uint64 n, uint64 wh, address by, string memory memo) external pure returns (string memory) {
        return ReceiptNote.note(n, wh, by, memo);
    }

    function recordPayload(string memory noteText) external pure returns (bytes memory) {
        return ReceiptNote.recordPayload(noteText);
    }

    function readId(bytes memory reply) external pure returns (uint64) {
        return ReceiptReply.readId(reply);
    }

    function isQuantumReady(address account) external view returns (bool) {
        return Pqc.isQuantumReady(account);
    }

    function keyOf(address account) external view returns (bytes memory) {
        return Pqc.keyOf(account);
    }

    function requireSignature(address signer, bytes memory message, bytes memory signature) external view {
        Pqc.requireSignature(signer, message, signature);
    }
}
