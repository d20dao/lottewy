// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {D20VRFConsumer} from "@d20dao/vrf-sdk/contracts/D20VRFConsumer.sol";
import {ID20VRF} from "@d20dao/vrf-sdk/contracts/interfaces/ID20VRF.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {EIP712Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/// @notice Upgradeable giveaway consumer. Upgrade authority is explicit; this
/// proxy must not be described as immutable. Direct starts remain permissionless.
contract LottewyConsumerV2 is D20VRFConsumer, Ownable2StepUpgradeable, EIP712Upgradeable, UUPSUpgradeable {
    struct Draw { address owner; bytes32 commitment; uint256 requestId; bytes32 word; uint8 status; }
    mapping(bytes32 => Draw) public draws;
    mapping(uint256 => bytes32) private requestKeys;
    mapping(uint256 => bool) private knownRequests;
    mapping(address => uint256) public overpaymentCredits;
    mapping(address => bool) public relayers;
    bool private entered;
    uint32 public constant CALLBACK_GAS = 150000;
    bytes32 public constant DRAW_INTENT_TYPEHASH = keccak256("DrawIntent(address owner,address executor,bytes32 giveawayId,bytes32 commitment,uint256 maxFee,uint256 deadline)");
    event DrawRequested(bytes32 indexed key,address indexed owner,bytes32 indexed giveawayId,bytes32 commitment,uint256 requestId);
    event DrawFulfilled(bytes32 indexed key,uint256 indexed requestId,bytes32 word);
    event DrawExpired(bytes32 indexed key,uint256 indexed requestId);
    event OverpaymentCredited(address indexed payer,uint256 amount);
    event OverpaymentWithdrawn(address indexed payer,address indexed recipient,uint256 amount);
    event RelayerUpdated(address indexed relayer,bool enabled);
    error InvalidState(); error TransferFailed(); error Reentrant(); error InsufficientFee(); error InvalidIntent(); error FeeAboveAuthorization();
    modifier nonReentrant() { if(entered)revert Reentrant();entered=true;_;entered=false; }
    modifier initialized() { if(owner()==address(0))revert InvalidState();_; }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(address coordinator_) D20VRFConsumer(coordinator_) { _disableInitializers(); }
    function initialize(address initialOwner) external initializer {
        __Ownable_init(initialOwner);
        __Ownable2Step_init();
        __EIP712_init("Lottewy Draw","2");
    }
    function coordinator() external view returns(address) { return vrfCoordinator; }
    function version() external pure virtual returns(uint256) { return 2; }
    function setRelayer(address relayer,bool enabled) external onlyOwner { if(relayer==address(0))revert InvalidState();relayers[relayer]=enabled;emit RelayerUpdated(relayer,enabled); }
    function renounceOwnership() public view override onlyOwner { revert InvalidState(); }
    function _authorizeUpgrade(address next) internal view override onlyOwner {
        if(LottewyConsumerV2(next).coordinator()!=vrfCoordinator)revert InvalidCoordinator();
    }
    function start(bytes32 giveawayId,bytes32 commitment) external payable initialized nonReentrant returns(uint256){
        return _start(msg.sender,giveawayId,commitment,msg.value,msg.sender);
    }
    function startFor(address drawOwner,bytes32 giveawayId,bytes32 commitment,uint256 maxFee,uint256 deadline,bytes calldata signature) external payable initialized nonReentrant returns(uint256){
        if(drawOwner==address(0)||block.timestamp>deadline)revert InvalidIntent();
        bytes32 digest=_hashTypedDataV4(keccak256(abi.encode(DRAW_INTENT_TYPEHASH,drawOwner,msg.sender,giveawayId,commitment,maxFee,deadline)));
        if(!SignatureChecker.isValidSignatureNow(drawOwner,digest,signature))revert InvalidIntent();
        return _start(drawOwner,giveawayId,commitment,maxFee,drawOwner);
    }
    /// @notice Trusted service relayers bind an authenticated payer to a draw.
    /// The offchain payment receipt must be checked by that service. This path
    /// does not claim to verify payment authorizations onchain.
    /// Coordinator fee refunds return to the service that paid the native fee;
    /// an API payer on another chain need not control the same address on Arc.
    function startSponsored(address drawOwner,bytes32 giveawayId,bytes32 commitment,uint256 maxFee) external payable initialized nonReentrant returns(uint256){
        if(!relayers[msg.sender]||drawOwner==address(0))revert InvalidIntent();
        return _start(drawOwner,giveawayId,commitment,maxFee,msg.sender);
    }
    function _start(address drawOwner,bytes32 giveawayId,bytes32 commitment,uint256 maxFee,address refundRecipient) private returns(uint256 requestId){
        bytes32 key=keccak256(abi.encode(drawOwner,giveawayId));
        if(draws[key].status!=0||commitment==bytes32(0))revert InvalidState();
        uint256 fee=ID20VRF(vrfCoordinator).quoteFee(CALLBACK_GAS);
        if(fee>maxFee)revert FeeAboveAuthorization();
        if(msg.value<fee)revert InsufficientFee();
        draws[key]=Draw(drawOwner,commitment,0,0,1);
        requestId=ID20VRF(vrfCoordinator).requestRandomness{value:fee}(commitment,CALLBACK_GAS,refundRecipient);
        draws[key].requestId=requestId;requestKeys[requestId]=key;knownRequests[requestId]=true;
        emit DrawRequested(key,drawOwner,giveawayId,commitment,requestId);
        uint256 change=msg.value-fee;
        if(change!=0){(bool ok,)=payable(msg.sender).call{value:change}("");if(!ok){overpaymentCredits[msg.sender]+=change;emit OverpaymentCredited(msg.sender,change);}}
    }
    function withdrawOverpayment(address payable recipient) external initialized nonReentrant {
        uint256 amount=overpaymentCredits[msg.sender];if(amount==0||recipient==address(0))revert InvalidState();
        overpaymentCredits[msg.sender]=0;(bool ok,)=recipient.call{value:amount}("");if(!ok)revert TransferFailed();
        emit OverpaymentWithdrawn(msg.sender,recipient,amount);
    }
    function _fulfillRandomness(uint256 requestId,bytes32 word) internal override {
        bytes32 key=requestKeys[requestId];Draw storage d=draws[key];
        if(!knownRequests[requestId]||d.status!=1||d.requestId!=requestId)revert InvalidState();
        d.word=word;d.status=2;emit DrawFulfilled(key,requestId,word);
    }
    function _onRefund(uint256 requestId) internal override {
        bytes32 key=requestKeys[requestId];Draw storage d=draws[key];
        if(!knownRequests[requestId]||d.status!=1)revert InvalidState();
        d.status=3;emit DrawExpired(key,requestId);
    }
}
