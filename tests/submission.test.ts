import {describe,it,expect} from 'vitest';
import {encodeFunctionData} from 'viem';
import {matchesSubmission} from '../worker/submission';
import {consumerAbi} from '../shared/chain';
import {hash,type Giveaway} from '../shared/core';
const owner='0x0000000000000000000000000000000000000001',consumer='0x0000000000000000000000000000000000000002';
const g={id:'test',owner,commitment:hash('manifest')} as Giveaway;
describe('signed transaction submission bindings',()=>{
 it('accepts only the reserved signer, nonce, consumer and manifest',()=>{const tx={from:owner,to:consumer,nonce:7,value:1n,input:encodeFunctionData({abi:consumerAbi,functionName:'start',args:[hash(g.id),g.commitment]})} as const;expect(()=>matchesSubmission(tx,g,consumer,7,'start')).not.toThrow();expect(()=>matchesSubmission({...tx,nonce:8},g,consumer,7,'start')).toThrow('nonce');expect(()=>matchesSubmission({...tx,from:consumer},g,consumer,7,'start')).toThrow('signer');expect(()=>matchesSubmission({...tx,input:encodeFunctionData({abi:consumerAbi,functionName:'start',args:[hash('other'),g.commitment]})},g,consumer,7,'start')).toThrow('inputs');});
 it('cancellation must be zero-value self-transfer consuming the exact reserved nonce',()=>{const tx={from:owner,to:owner,nonce:7,value:0n,input:'0x'} as const;expect(()=>matchesSubmission(tx,g,consumer,7,'cancel')).not.toThrow();expect(()=>matchesSubmission({...tx,value:1n},g,consumer,7,'cancel')).toThrow();expect(()=>matchesSubmission({...tx,to:consumer},g,consumer,7,'cancel')).toThrow();expect(()=>matchesSubmission(tx,g,consumer,null,'cancel')).toThrow();});
});
