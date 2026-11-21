// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {QoreTest} from "../mocks/QoreTest.sol";
import {Mentari} from "../../src/Mentari.sol";

/// Shared set-up for the Mentari tests: mocks installed, keys for the registrar, one meter, one producer and one
/// holder, and the clock moved to a fixed UTC day.
abstract contract MentariBase is QoreTest {
    uint256 internal constant REGISTRAR_KEY = 1;
    uint256 internal constant METER_KEY = 2;
    uint256 internal constant PRODUCER_KEY = 3;
    uint256 internal constant ALICE_KEY = 4;
    uint32 internal constant TODAY = 20_000;
    uint32 internal constant FIRST_DAY = TODAY - 10;
    uint32 internal constant SYSTEM = 1;
    uint32 internal constant CAPACITY_W = 5000;
    uint16 internal constant SUN_X10 = 80;
    /// 5000 W for 8.0 hours.
    uint64 internal constant MAX_WH = 40_000;

    address internal registrar = makeAddr("registrar");
    address internal meter = makeAddr("meter");
    address internal producer = makeAddr("producer");
    address internal alice = makeAddr("alice");
    address internal nobody = makeAddr("nobody");
    Mentari internal mentari;

    function setUp() public virtual {
        _installMocks();
        _giveKey(registrar, REGISTRAR_KEY);
        _giveKey(meter, METER_KEY);
        _giveKey(producer, PRODUCER_KEY);
        _giveKey(alice, ALICE_KEY);
        vm.warp(uint256(TODAY) * 1 days + 3600);
        mentari = new Mentari(registrar, RECEIPTS, SUN_X10);
    }

    function _registerSig(uint32 id, address m, address p, uint32 capacityW, uint32 firstDay)
        internal
        view
        returns (bytes memory)
    {
        return _sign(REGISTRAR_KEY, mentari.registerMessage(id, m, p, capacityW, firstDay));
    }

    function _register() internal {
        mentari.registerSystem(
            SYSTEM, meter, producer, CAPACITY_W, FIRST_DAY, _registerSig(SYSTEM, meter, producer, CAPACITY_W, FIRST_DAY)
        );
    }

    function _attest(uint32 day, uint64 wh) internal {
        mentari.attest(SYSTEM, day, wh, _sign(METER_KEY, mentari.attestMessage(SYSTEM, day, wh)));
    }

    /// Registers the system, mints `wh` to the producer for yesterday and moves it all to alice.
    function _fundAlice(uint64 wh) internal {
        _register();
        _attest(TODAY - 1, wh);
        vm.prank(producer);
        mentari.transfer(alice, wh);
    }

    function _hex(address a) internal pure returns (string memory) {
        return vm.toLowercase(vm.toString(a));
    }
}
