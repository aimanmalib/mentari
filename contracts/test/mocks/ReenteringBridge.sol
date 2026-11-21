// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/// A hostile bridge stand-in: instead of answering, it calls `retire` on the caller again and passes on the
/// revert. Used to show that `Mentari.retire` cannot be re-entered.
contract ReenteringBridge {
    fallback() external {
        (bool ok, bytes memory ret) = msg.sender.call(abi.encodeWithSignature("retire(uint256,string)", 1, ""));
        if (!ok) {
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
    }
}
