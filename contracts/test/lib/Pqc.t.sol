// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {QoreTest} from "../mocks/QoreTest.sol";
import {LibHarness} from "../mocks/LibHarness.sol";
import {Pqc} from "../../src/lib/Pqc.sol";

contract PqcTest is QoreTest {
    LibHarness internal h;
    address internal constant ALICE = address(0xA11CE);
    address internal constant BOB = address(0xB0B);
    bytes internal constant MESSAGE = "Mentari:test:v1";

    function setUp() public {
        _installMocks();
        h = new LibHarness();
    }

    function test_readyWhenRegisteredProvenAndMlDsa87() public {
        bytes memory k = _giveKey(ALICE, 1);
        assertTrue(h.isQuantumReady(ALICE));
        assertEq(h.keyOf(ALICE), k);
    }

    function test_notReadyWithoutAKey() public {
        assertFalse(h.isQuantumReady(BOB));
        vm.expectRevert(abi.encodeWithSelector(Pqc.KeyNotRegistered.selector, BOB));
        h.keyOf(BOB);
    }

    function test_notReadyWithoutProofOfPossession() public {
        keys.setKey(BOB, true, 1, _pubkey(2), false);
        assertFalse(h.isQuantumReady(BOB));
        vm.expectRevert(abi.encodeWithSelector(Pqc.KeyNotProven.selector, BOB));
        h.keyOf(BOB);
    }

    function test_notReadyWithAnotherAlgorithm() public {
        keys.setKey(BOB, true, 2, _pubkey(2), true);
        assertFalse(h.isQuantumReady(BOB));
        vm.expectRevert(abi.encodeWithSelector(Pqc.KeyNotRegistered.selector, BOB));
        h.keyOf(BOB);
    }

    function test_notReadyWithAShortKey() public {
        keys.setKey(BOB, true, 1, hex"0102", true);
        assertFalse(h.isQuantumReady(BOB));
        vm.expectRevert(abi.encodeWithSelector(Pqc.KeyNotRegistered.selector, BOB));
        h.keyOf(BOB);
    }

    function test_notReadyWhenRegisteredIsFalse() public {
        keys.setKey(BOB, false, 1, _pubkey(2), true);
        assertFalse(h.isQuantumReady(BOB));
    }

    function test_validSignaturePasses() public {
        _giveKey(ALICE, 1);
        h.requireSignature(ALICE, MESSAGE, _sign(1, MESSAGE));
    }

    function test_signatureFromAnotherKeyFails() public {
        _giveKey(ALICE, 1);
        bytes memory sig = _sign(2, MESSAGE);
        vm.expectRevert(abi.encodeWithSelector(Pqc.BadSignature.selector, ALICE));
        h.requireSignature(ALICE, MESSAGE, sig);
    }

    function test_signatureOverAnotherMessageFails() public {
        _giveKey(ALICE, 1);
        bytes memory sig = _sign(1, "Mentari:other:v1");
        vm.expectRevert(abi.encodeWithSelector(Pqc.BadSignature.selector, ALICE));
        h.requireSignature(ALICE, MESSAGE, sig);
    }

    function test_wrongSignatureLengthFails() public {
        _giveKey(ALICE, 1);
        vm.expectRevert(abi.encodeWithSelector(Pqc.BadSignatureLength.selector, 64));
        h.requireSignature(ALICE, MESSAGE, new bytes(64));
    }

    function test_signerWithoutKeyFails() public {
        bytes memory sig = _sign(1, MESSAGE);
        vm.expectRevert(abi.encodeWithSelector(Pqc.KeyNotRegistered.selector, BOB));
        h.requireSignature(BOB, MESSAGE, sig);
    }

    function test_inactiveKeyRegistryIsNamed() public {
        vm.etch(KEYS_ADDR, "");
        vm.expectRevert(Pqc.PqcUnavailable.selector);
        h.isQuantumReady(ALICE);
    }

    function test_inactiveVerifierIsNamed() public {
        _giveKey(ALICE, 1);
        bytes memory sig = _sign(1, MESSAGE);
        vm.etch(VERIFY_ADDR, "");
        vm.expectRevert(Pqc.PqcUnavailable.selector);
        h.requireSignature(ALICE, MESSAGE, sig);
    }

    function testFuzz_onlyTheMatchingKeySigns(uint256 signerSeed, uint256 otherSeed, bytes memory message) public {
        vm.assume(signerSeed != otherSeed);
        _giveKey(ALICE, signerSeed);
        h.requireSignature(ALICE, message, _sign(signerSeed, message));
        bytes memory forged = _sign(otherSeed, message);
        vm.expectRevert(abi.encodeWithSelector(Pqc.BadSignature.selector, ALICE));
        h.requireSignature(ALICE, message, forged);
    }
}
