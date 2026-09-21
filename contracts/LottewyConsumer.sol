// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
import {D20VRFConsumer} from "@d20dao/vrf-sdk/contracts/D20VRFConsumer.sol";
import {ID20VRF} from "@d20dao/vrf-sdk/contracts/interfaces/ID20VRF.sol";

/// @notice Permissionless, non-upgradeable. No owner, platform fee or treasury.
/// Entries stay offchain. The coordinator receives their public manifest commitment.
contract LottewyConsumer is D20VRFConsumer {
    struct Draw { address owner; bytes32 commitment; uint256 requestId; bytes32 word; uint8 status; }
    mapping(bytes32 => Draw) public draws;
    mapping(uint256 => bytes32) private requestKeys;
    mapping(uint256 => bool) private knownRequests;
    mapping(address => uint256) public overpaymentCredits;
    bool private entered;
    uint32 public constant CALLBACK_GAS = 150000;
    event DrawRequested(bytes32 indexed key, address indexed owner, bytes32 indexed giveawayId, bytes32 commitment, uint256 requestId);
    event DrawFulfilled(bytes32 indexed key, uint256 indexed requestId, bytes32 word);
    event DrawExpired(bytes32 indexed key, uint256 indexed requestId);
    event OverpaymentCredited(address indexed owner, uint256 amount);
    event OverpaymentWithdrawn(address indexed owner, address indexed recipient, uint256 amount);
    error InvalidState(); error TransferFailed(); error Reentrant(); error InsufficientFee();
    modifier nonReentrant() { if (entered) revert Reentrant(); entered = true; _; entered = false; }
    constructor(address coordinator_) D20VRFConsumer(coordinator_) {}
    function coordinator() external view returns (address) { return vrfCoordinator; }
    function start(bytes32 giveawayId, bytes32 commitment) external payable nonReentrant returns (uint256 requestId) {
        bytes32 key = keccak256(abi.encode(msg.sender, giveawayId));
        if (draws[key].status != 0 || commitment == bytes32(0)) revert InvalidState();
        uint256 fee = ID20VRF(vrfCoordinator).quoteFee(CALLBACK_GAS);
        if (msg.value < fee) revert InsufficientFee();
        draws[key] = Draw(msg.sender, commitment, 0, 0, 1);
        // Refunds of the D20 fee always belong directly to the payer, not this contract.
        requestId = ID20VRF(vrfCoordinator).requestRandomness{value: fee}(commitment, CALLBACK_GAS, msg.sender);
        draws[key].requestId = requestId; requestKeys[requestId] = key; knownRequests[requestId] = true;
        emit DrawRequested(key, msg.sender, giveawayId, commitment, requestId);
        uint256 change = msg.value - fee;
        if (change != 0) {
            (bool ok,) = payable(msg.sender).call{value: change}("");
            if (!ok) { overpaymentCredits[msg.sender] += change; emit OverpaymentCredited(msg.sender, change); }
        }
    }
    function withdrawOverpayment(address payable recipient) external nonReentrant {
        uint256 amount = overpaymentCredits[msg.sender];
        if (amount == 0 || recipient == address(0)) revert InvalidState();
        overpaymentCredits[msg.sender] = 0;
        (bool ok,) = recipient.call{value: amount}(""); if (!ok) revert TransferFailed();
        emit OverpaymentWithdrawn(msg.sender, recipient, amount);
    }
    function _fulfillRandomness(uint256 requestId, bytes32 word) internal override {
        bytes32 key = requestKeys[requestId]; Draw storage d = draws[key];
        if (!knownRequests[requestId] || d.status != 1 || d.requestId != requestId) revert InvalidState();
        d.word = word; d.status = 2; emit DrawFulfilled(key, requestId, word);
    }
    function _onRefund(uint256 requestId) internal override {
        bytes32 key = requestKeys[requestId]; Draw storage d = draws[key];
        if (!knownRequests[requestId] || d.status != 1) revert InvalidState();
        d.status = 3; emit DrawExpired(key, requestId);
        // Permanent lock survives expiry. V1 intentionally has no new-word retry.
    }
}
