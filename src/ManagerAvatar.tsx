import {useState} from 'react';
import {CircleUserRound} from 'lucide-react';
import type {AccountManager} from './types.ts';
import {managerProfile} from './manager-profiles.ts';

export default function ManagerAvatar({manager,large=false}:{manager:Pick<AccountManager,'name'|'profileImage'>;large?:boolean}){
 const profile=managerProfile(manager);const [failed,setFailed]=useState('');
 const preset=profile==='team-a'||profile==='team-b';
 return <span className={`am-avatar${large?' large':''}${preset?' am-avatar-'+profile:!profile||failed===profile?' am-avatar-blank':''}`}>
  {preset?<span role="img" aria-label={`${manager.name} profile image`}>{profile==='team-a'?'Team A':'Team B'}</span>:profile&&failed!==profile?<img src={profile} alt={`${manager.name} profile image`} onError={()=>setFailed(profile)}/>:<CircleUserRound role="img" aria-label="No profile image" size={large?40:28} strokeWidth={1}/>}
 </span>;
}
