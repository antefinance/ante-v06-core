// SPDX-License-Identifier: GPL-3.0-only

// ┏━━━┓━━━━━┏┓━━━━━━━━━┏━━━┓━━━━━━━━━━━━━━━━━━━━━━━
// ┃┏━┓┃━━━━┏┛┗┓━━━━━━━━┃┏━━┛━━━━━━━━━━━━━━━━━━━━━━━
// ┃┗━┛┃┏━┓━┗┓┏┛┏━━┓━━━━┃┗━━┓┏┓┏━┓━┏━━┓━┏━┓━┏━━┓┏━━┓
// ┃┏━┓┃┃┏┓┓━┃┃━┃┏┓┃━━━━┃┏━━┛┣┫┃┏┓┓┗━┓┃━┃┏┓┓┃┏━┛┃┏┓┃
// ┃┃ ┃┃┃┃┃┃━┃┗┓┃┃━┫━┏┓━┃┃━━━┃┃┃┃┃┃┃┗┛┗┓┃┃┃┃┃┗━┓┃┃━┫
// ┗┛ ┗┛┗┛┗┛━┗━┛┗━━┛━┗┛━┗┛━━━┗┛┗┛┗┛┗━━━┛┗┛┗┛┗━━┛┗━━┛
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

pragma solidity ^0.8.0;

import "../AnteTest.sol";

contract AnteStateTest is AnteTest("Mock test of various test state types with names") {
    uint256 public uintValue;
    address[] public addresses;
    string public stringValue;
    bytes32 public bytesValue;

    constructor() {
        protocolName = "MockFi";
    }

    function getStateTypes() external pure override returns (string memory) {
        return "uint256,address[],string,bytes32";
    }

    function getStateNames() external pure override returns (string memory) {
        return "uintValue,addresses,stringValue,bytesValue";
    }

    // failing bytes32 value: 0x3b2564d7e0fe091d49b4c20f4632191e4ed6986bf993849879abfef9465def25
    function checkTestPasses() public view override returns (bool) {
        if (
            uintValue == 1 &&
            addresses.length == 1 &&
            keccak256(abi.encodePacked(stringValue)) == keccak256(abi.encodePacked("fail")) &&
            bytesValue == keccak256(abi.encodePacked("fail"))
        ) {
            return false;
        }
        return true;
    }

    function _setState(bytes memory _state) internal override {
        (uintValue, addresses, stringValue, bytesValue) = abi.decode(_state, (uint256, address[], string, bytes32));
    }
}
