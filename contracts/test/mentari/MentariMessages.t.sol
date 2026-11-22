// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Mentari} from "../../src/Mentari.sol";

/// Pins the signed message bytes to fixed hashes. `scripts/test/meter.test.ts` checks the same hashes for the
/// off-chain encoder, so a change on either side fails one of the two suites.
contract MentariMessagesTest is Test {
    address internal constant AT = 0x00000000000000000000000000000000004D3E17;

    function setUp() public {
        vm.chainId(9800);
        deployCodeTo("Mentari.sol:Mentari", abi.encode(address(0xA1), "qor1book", uint16(80)), AT);
    }

    function test_attestMessageMatchesOffChainVector() public view {
        bytes memory m = Mentari(AT).attestMessage(2, 20_400, 23_456);
        assertEq(keccak256(m), 0x19bcb0e56e049e7743abf17a6c888b3a3dcfa5b00d4af8ce61a7f9b1fbe2e00f);
    }

    function test_registerMessageMatchesOffChainVector() public view {
        bytes memory m = Mentari(AT).registerMessage(2, address(0xA2), address(0xB5), 8200, 20_397);
        assertEq(keccak256(m), 0xd8b8d051cfe18276cd6c9f97f4f0b52df8562d86bcee807d0e0d278a47b89abc);
    }
}
