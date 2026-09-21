// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
interface IConsumer { function rawFulfillRandomness(uint256,bytes32) external; function onRefund(uint256) external; }
contract MockCoordinator {
 struct Request { address consumer; address payer; uint256 paid; uint256 deadline; bytes32 word; bool fulfilled; bool delivered; bool refunded; }
 mapping(uint256=>Request) public requests; mapping(address=>uint256) public refundCredits; uint256 public next=1;
 function quoteFee(uint32) external pure returns(uint256){return 1 ether;}
 function requestRandomness(bytes32,uint32,address payer) external payable returns(uint256 id){require(msg.value==1 ether);id=next++;requests[id]=Request(msg.sender,payer,msg.value,block.timestamp+60,0,false,false,false);}
 function accept(uint256 id,bytes32 word,uint32 gasLimit) external {Request storage r=requests[id];require(!r.fulfilled&&!r.refunded&&block.timestamp<=r.deadline);r.word=word;r.fulfilled=true;(r.delivered,)=r.consumer.call{gas:gasLimit}(abi.encodeCall(IConsumer.rawFulfillRandomness,(id,word)));}
 function retryCallback(uint256 id,uint32 gasLimit) external {Request storage r=requests[id];require(r.fulfilled&&!r.delivered);(r.delivered,)=r.consumer.call{gas:gasLimit}(abi.encodeCall(IConsumer.rawFulfillRandomness,(id,r.word)));}
 function refundRequest(uint256 id) external {Request storage r=requests[id];require(!r.fulfilled&&!r.refunded&&block.timestamp>r.deadline);r.refunded=true;(bool ok,)=r.payer.call{value:r.paid}("");if(!ok)refundCredits[r.payer]+=r.paid;IConsumer(r.consumer).onRefund(id);}
 function withdrawRefundCredit(address payable to) external {uint256 amount=refundCredits[msg.sender];require(amount>0);refundCredits[msg.sender]=0;(bool ok,)=to.call{value:amount}("");require(ok);}
 function forgedCallback(address consumer,uint256 id,bytes32 word) external {IConsumer(consumer).rawFulfillRandomness(id,word);}
}
interface ILottewy {function start(bytes32,bytes32) external payable returns(uint256);function withdrawOverpayment(address payable) external;}
contract RejectingPayer {
 function start(address consumer,bytes32 id,bytes32 commitment) external payable {ILottewy(consumer).start{value:msg.value}(id,commitment);}
 function withdraw(address consumer,address payable to) external {ILottewy(consumer).withdrawOverpayment(to);}
 function withdrawD20(address coordinator,address payable to) external {MockCoordinator(coordinator).withdrawRefundCredit(to);}
 receive() external payable {revert();}
}
