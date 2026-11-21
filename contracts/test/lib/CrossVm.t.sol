// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {QoreTest} from "../mocks/QoreTest.sol";
import {LibHarness} from "../mocks/LibHarness.sol";
import {MockCrossVmBridge} from "../mocks/MockCrossVmBridge.sol";
import {CrossVm} from "../../src/lib/CrossVm.sol";

contract CrossVmTest is QoreTest {
    LibHarness internal h;
    bytes internal constant RECORD = '{"record":{"note":"hello"}}';

    function setUp() public {
        _installMocks();
        h = new LibHarness();
    }

    function test_recordReachesNativeAndReturnsTheReceipt() public {
        bytes memory reply = h.callNative(RECEIPTS, RECORD);
        assertEq(
            string(reply),
            string.concat('{"id":1,"sender":"', vm.toLowercase(vm.toString(address(h))), '","note":"hello","height":1}')
        );
        assertEq(bridge.count(), 1);
        assertEq(bridge.receiptsBy(address(h)), 1);
        MockCrossVmBridge.Receipt memory r = bridge.receipt(1);
        assertEq(r.sender, address(h));
        assertEq(r.note, "hello");
    }

    function test_nativeRefusalRevertsWithTheReason() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                CrossVm.BridgeCallFailed.selector,
                abi.encodeWithSignature("Error(string)", "refused on purpose by the Native contract")
            )
        );
        h.callNative(RECEIPTS, '{"fail":{}}');
        assertEq(bridge.count(), 0);
    }

    function test_targetRefusesMode() public {
        bridge.setMode(MockCrossVmBridge.Mode.TargetRefuses);
        vm.expectRevert(
            abi.encodeWithSelector(
                CrossVm.BridgeCallFailed.selector,
                abi.encodeWithSignature("Error(string)", "refused by the Native contract")
            )
        );
        h.callNative(RECEIPTS, RECORD);
    }

    function test_targetNotOnTheAllowlistIsRefused() public {
        string memory other = "qor1notallowlisted";
        vm.expectRevert(
            abi.encodeWithSelector(
                CrossVm.BridgeCallFailed.selector,
                abi.encodeWithSignature(
                    "Error(string)", string.concat("REFUSED by the bridge: ", other, " is not allowlisted")
                )
            )
        );
        h.callNative(other, RECORD);
    }

    function test_noCodeAtTheBridgeMeansNotActive() public {
        vm.etch(BRIDGE_ADDR, "");
        vm.expectRevert(CrossVm.BridgeNotActive.selector);
        h.callNative(RECEIPTS, RECORD);
    }

    function test_emptyReplyModeMeansNotActive() public {
        bridge.setMode(MockCrossVmBridge.Mode.Inactive);
        vm.expectRevert(CrossVm.BridgeNotActive.selector);
        h.callNative(RECEIPTS, RECORD);
    }

    function test_bridgeRefusesValue() public {
        (bool ok,) = BRIDGE_ADDR.call{value: 1}(
            abi.encodeWithSignature("executeCrossVMCall(uint8,string,bytes)", uint8(1), RECEIPTS, RECORD)
        );
        assertFalse(ok);
    }

    function test_bridgeRefusesStaticCall() public view {
        (bool ok,) = BRIDGE_ADDR.staticcall(
            abi.encodeWithSignature("executeCrossVMCall(uint8,string,bytes)", uint8(1), RECEIPTS, RECORD)
        );
        assertFalse(ok);
    }

    function test_bridgeRefusesAnotherVm() public {
        (bool ok,) = BRIDGE_ADDR.call(
            abi.encodeWithSignature("executeCrossVMCall(uint8,string,bytes)", uint8(2), RECEIPTS, RECORD)
        );
        assertFalse(ok);
    }

    function test_unwrapAbiEncodedReply() public view {
        assertEq(h.unwrapReply(abi.encode(bytes('{"id":9}'))), bytes('{"id":9}'));
        assertEq(h.unwrapReply(abi.encode(bytes(""))), bytes(""));
    }

    function test_unwrapRawReplyFromOlderNodes() public view {
        bytes memory raw = bytes('{"id":9,"sender":"qor1abc","note":"padding to more than sixty four bytes long"}');
        assertGt(raw.length, 64);
        assertEq(h.unwrapReply(raw), raw);
        assertEq(h.unwrapReply(bytes('{"id":9}')), bytes('{"id":9}'));
    }

    function test_unwrapRejectsLengthPastTheData() public {
        bytes memory bad = abi.encode(uint256(32), uint256(64), bytes32("only one word"));
        vm.expectRevert(CrossVm.BridgeReplyMalformed.selector);
        h.unwrapReply(bad);
    }

    function test_unwrapRejectsMissingPadding() public {
        bytes memory good = abi.encode(bytes("abc"));
        bytes memory cut = new bytes(good.length - 1);
        for (uint256 i; i < cut.length; ++i) {
            cut[i] = good[i];
        }
        vm.expectRevert(CrossVm.BridgeReplyMalformed.selector);
        h.unwrapReply(cut);
    }

    function testFuzz_unwrapRoundTrips(bytes memory reply) public view {
        assertEq(h.unwrapReply(abi.encode(reply)), reply);
    }
}
