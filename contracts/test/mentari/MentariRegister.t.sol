// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {MentariBase} from "./MentariBase.sol";
import {Mentari} from "../../src/Mentari.sol";
import {Pqc} from "../../src/lib/Pqc.sol";

contract MentariRegisterTest is MentariBase {
    function test_constructorSetsFixedValues() public view {
        assertEq(mentari.registrar(), registrar);
        assertEq(mentari.receiptsBook(), RECEIPTS);
        assertEq(mentari.maxSunHoursX10(), SUN_X10);
        assertEq(mentari.name(), "Mentari Solar Watt-hour");
        assertEq(mentari.symbol(), "MTR");
        assertEq(mentari.decimals(), 0);
        assertEq(mentari.nonce(), 0);
        assertEq(mentari.currentDay(), TODAY);
    }

    function test_constructorRejectsZeroRegistrar() public {
        vm.expectRevert(Mentari.ZeroAddress.selector);
        new Mentari(address(0), RECEIPTS, SUN_X10);
    }

    function test_constructorRejectsEmptyReceiptsBook() public {
        vm.expectRevert(Mentari.EmptyReceiptsBook.selector);
        new Mentari(registrar, "", SUN_X10);
    }

    function test_constructorRejectsSunHoursOutOfRange() public {
        vm.expectRevert(abi.encodeWithSelector(Mentari.BadMaxSunHours.selector, uint16(0)));
        new Mentari(registrar, RECEIPTS, 0);
        vm.expectRevert(abi.encodeWithSelector(Mentari.BadMaxSunHours.selector, uint16(241)));
        new Mentari(registrar, RECEIPTS, 241);
        assertEq(new Mentari(registrar, RECEIPTS, 240).maxWh(1000), 24_000);
    }

    function test_registerMessageIsTheDocumentedLayout() public view {
        bytes memory expected = abi.encodePacked(
            "Mentari:register:v1",
            block.chainid,
            address(mentari),
            uint256(0),
            SYSTEM,
            meter,
            producer,
            CAPACITY_W,
            FIRST_DAY
        );
        assertEq(mentari.registerMessage(SYSTEM, meter, producer, CAPACITY_W, FIRST_DAY), expected);
    }

    function test_registerStoresTheSystemAndBumpsTheNonce() public {
        vm.expectEmit(address(mentari));
        emit Mentari.SystemRegistered(SYSTEM, meter, producer, CAPACITY_W, FIRST_DAY);
        vm.prank(nobody); // anyone may submit; the signature is what counts
        mentari.registerSystem(
            SYSTEM, meter, producer, CAPACITY_W, FIRST_DAY, _registerSig(SYSTEM, meter, producer, CAPACITY_W, FIRST_DAY)
        );
        Mentari.System memory s = mentari.system(SYSTEM);
        assertEq(s.meter, meter);
        assertEq(s.producer, producer);
        assertEq(s.capacityW, CAPACITY_W);
        assertEq(s.firstDay, FIRST_DAY);
        assertEq(mentari.nonce(), 1);
    }

    function test_registerRejectsZeroCapacity() public {
        bytes memory sig = _registerSig(SYSTEM, meter, producer, 0, FIRST_DAY);
        vm.expectRevert(Mentari.ZeroCapacity.selector);
        mentari.registerSystem(SYSTEM, meter, producer, 0, FIRST_DAY, sig);
    }

    function test_registerRejectsATakenId() public {
        _register();
        bytes memory sig = _registerSig(SYSTEM, meter, producer, CAPACITY_W, FIRST_DAY);
        vm.expectRevert(abi.encodeWithSelector(Mentari.SystemExists.selector, SYSTEM));
        mentari.registerSystem(SYSTEM, meter, producer, CAPACITY_W, FIRST_DAY, sig);
    }

    function test_registerRejectsAMeterWithoutAKey() public {
        bytes memory sig = _registerSig(SYSTEM, nobody, producer, CAPACITY_W, FIRST_DAY);
        vm.expectRevert(abi.encodeWithSelector(Mentari.NotQuantumReady.selector, nobody));
        mentari.registerSystem(SYSTEM, nobody, producer, CAPACITY_W, FIRST_DAY, sig);
    }

    function test_registerRejectsAProducerWithAnUnprovenKey() public {
        keys.setKey(nobody, true, 1, _pubkey(9), false);
        bytes memory sig = _registerSig(SYSTEM, meter, nobody, CAPACITY_W, FIRST_DAY);
        vm.expectRevert(abi.encodeWithSelector(Mentari.NotQuantumReady.selector, nobody));
        mentari.registerSystem(SYSTEM, meter, nobody, CAPACITY_W, FIRST_DAY, sig);
    }

    function test_registerRejectsARegistrarWithoutAKey() public {
        Mentari other = new Mentari(nobody, RECEIPTS, SUN_X10);
        bytes memory sig = _sign(REGISTRAR_KEY, other.registerMessage(SYSTEM, meter, producer, CAPACITY_W, FIRST_DAY));
        vm.expectRevert(abi.encodeWithSelector(Pqc.KeyNotRegistered.selector, nobody));
        other.registerSystem(SYSTEM, meter, producer, CAPACITY_W, FIRST_DAY, sig);
    }

    function test_registerRejectsASignatureByAnotherKey() public {
        bytes memory sig = _sign(METER_KEY, mentari.registerMessage(SYSTEM, meter, producer, CAPACITY_W, FIRST_DAY));
        vm.expectRevert(abi.encodeWithSelector(Pqc.BadSignature.selector, registrar));
        mentari.registerSystem(SYSTEM, meter, producer, CAPACITY_W, FIRST_DAY, sig);
    }

    function test_registerRejectsChangedFields() public {
        bytes memory sig = _registerSig(SYSTEM, meter, producer, CAPACITY_W, FIRST_DAY);
        vm.expectRevert(abi.encodeWithSelector(Pqc.BadSignature.selector, registrar));
        mentari.registerSystem(SYSTEM, meter, producer, CAPACITY_W * 2, FIRST_DAY, sig);
    }

    function test_registerRejectsAShortSignature() public {
        vm.expectRevert(abi.encodeWithSelector(Pqc.BadSignatureLength.selector, uint256(64)));
        mentari.registerSystem(SYSTEM, meter, producer, CAPACITY_W, FIRST_DAY, new bytes(64));
    }

    function test_registerRejectsAReplayedOldNonce() public {
        // Signed while the nonce was 0, used after another registration moved it to 1.
        bytes memory stale = _registerSig(2, meter, producer, CAPACITY_W, FIRST_DAY);
        _register();
        vm.expectRevert(abi.encodeWithSelector(Pqc.BadSignature.selector, registrar));
        mentari.registerSystem(2, meter, producer, CAPACITY_W, FIRST_DAY, stale);
    }

    function test_registerRejectsASignatureForAnotherChain() public {
        bytes memory sig = _registerSig(SYSTEM, meter, producer, CAPACITY_W, FIRST_DAY);
        vm.chainId(block.chainid + 1);
        vm.expectRevert(abi.encodeWithSelector(Pqc.BadSignature.selector, registrar));
        mentari.registerSystem(SYSTEM, meter, producer, CAPACITY_W, FIRST_DAY, sig);
    }

    function test_registerRejectsASignatureForAnotherContract() public {
        Mentari other = new Mentari(registrar, RECEIPTS, SUN_X10);
        bytes memory sig = _sign(REGISTRAR_KEY, other.registerMessage(SYSTEM, meter, producer, CAPACITY_W, FIRST_DAY));
        vm.expectRevert(abi.encodeWithSelector(Pqc.BadSignature.selector, registrar));
        mentari.registerSystem(SYSTEM, meter, producer, CAPACITY_W, FIRST_DAY, sig);
    }

    function test_systemViewRejectsAnUnknownId() public {
        vm.expectRevert(abi.encodeWithSelector(Mentari.UnknownSystem.selector, uint32(7)));
        mentari.system(7);
    }

    function test_isQuantumReadyReadsTheKeyRegistry() public {
        assertTrue(mentari.isQuantumReady(alice));
        assertFalse(mentari.isQuantumReady(nobody));
        keys.setKey(nobody, true, 1, _pubkey(9), false);
        assertFalse(mentari.isQuantumReady(nobody));
    }
}
