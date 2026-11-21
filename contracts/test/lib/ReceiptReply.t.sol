// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {LibHarness} from "../mocks/LibHarness.sol";
import {ReceiptReply} from "../../src/lib/ReceiptReply.sol";

contract ReceiptReplyTest is Test {
    LibHarness internal h;
    /// The shape `qday-receipts` stores and returns: `Receipt { id, sender, note, height }`.
    bytes internal constant NATIVE_SHAPE =
        '{"id":42,"sender":"qor1xjayq5ev55tkzpml9klxwyshr7gdrha0nurha9jhm0f0gdckksgs3gltw8","note":"MTR1 n=1 wh=5 by=0x00 m=a/b #1","height":1234567}';

    function setUp() public {
        h = new LibHarness();
    }

    function test_readsTheIdFromTheNativeShape() public view {
        assertEq(h.readId(NATIVE_SHAPE), 42);
    }

    function test_acceptsOtherKeyOrdersWhitespaceAndNesting() public view {
        assertEq(h.readId(' \n{ "height" : 5 , "id" : 7 }\t'), 7);
        assertEq(h.readId('{"meta":{"a":[1,-2.5e+3,true,false,null,{"id":99}],"s":"x\\"y\\u00e9"},"id":3}'), 3);
        assertEq(h.readId('{"id":18446744073709551615}'), type(uint64).max);
        assertEq(h.readId('{"note":"has \\"id\\":5 inside","id":1}'), 1);
    }

    function test_refusesMalformedReplies() public {
        bytes[29] memory bad = [
            bytes(""),
            "   ",
            "{}",
            "[]",
            '[{"id":1}]',
            '{"id":1',
            '{"id":1}}',
            '{"id":1} x',
            '{"id":1,}',
            '{"id":1,"id":2}',
            '{"i\\u0064":1,"id":2}',
            '{"id":0}',
            '{"id":01}',
            '{"id":-1}',
            '{"id":1.0}',
            '{"id":1e3}',
            '{"id":"1"}',
            '{"id":18446744073709551616}',
            '{"id":1,"x":tru}',
            '{"id":1,"x":"open}',
            '{"id":1,"x":"bad \\q escape"}',
            '{"id":1,"x":"\\u12"}',
            '{"id":1,"x":01}',
            '{"id":1,"x":1.}',
            '{"id":1,"x":-}',
            '{"id" 1}',
            "{id:1}",
            '{"x":{"id":1}}',
            '{"id":1,"x":[[[[[[[[[1]]]]]]]]]}'
        ];
        for (uint256 i; i < bad.length; ++i) {
            vm.expectRevert(ReceiptReply.BadReply.selector);
            h.readId(bad[i]);
        }
    }

    function test_refusesControlCharacterInsideAString() public {
        vm.expectRevert(ReceiptReply.BadReply.selector);
        h.readId(bytes.concat('{"id":1,"x":"a', bytes1(0x0a), 'b"}'));
    }

    function test_nestingUpToTheLimitIsAccepted() public view {
        assertEq(h.readId('{"id":1,"x":[[[[[[[1]]]]]]]}'), 1);
    }

    function testFuzz_anyIdRoundTrips(uint64 id) public view {
        vm.assume(id > 0);
        bytes memory reply = bytes(string.concat('{"id":', vm.toString(uint256(id)), ',"note":"n","height":9}'));
        assertEq(h.readId(reply), id);
    }

    /// Every strict prefix of a valid reply is incomplete JSON and must be refused.
    function testFuzz_truncatedReplyIsRefused(uint256 cut) public {
        cut = bound(cut, 0, NATIVE_SHAPE.length - 1);
        bytes memory prefix = new bytes(cut);
        for (uint256 i; i < cut; ++i) {
            prefix[i] = NATIVE_SHAPE[i];
        }
        vm.expectRevert(ReceiptReply.BadReply.selector);
        h.readId(prefix);
    }

    /// Anything other than whitespace after the closing brace makes the reply invalid.
    function testFuzz_trailingByteIsRefused(bytes1 extra) public {
        vm.assume(extra != " " && extra != "\n" && extra != "\r" && extra != "\t");
        vm.expectRevert(ReceiptReply.BadReply.selector);
        h.readId(bytes.concat(NATIVE_SHAPE, extra));
    }

    /// Arbitrary bytes never panic or run out of gas: the reader either returns an id or says BadReply.
    function testFuzz_arbitraryBytesOnlyFailWithBadReply(bytes memory reply) public view {
        try h.readId(reply) returns (uint64 id) {
            assertGt(id, 0);
        } catch (bytes memory err) {
            assertEq(err, abi.encodeWithSelector(ReceiptReply.BadReply.selector));
        }
    }
}
