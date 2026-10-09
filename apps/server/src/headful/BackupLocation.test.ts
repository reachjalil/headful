// Native fixture owns only its temporary SQLite store. No provider process is started.
import {afterEach,expect,it,vi} from "vite-plus/test";
// @effect-diagnostics-next-line nodeBuiltinImport:off - native test fixture owns only its temporary SQLite directory.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
// @effect-diagnostics-next-line nodeBuiltinImport:off - native test fixture uses an explicit temporary path.
import * as NodePath from "node:path";
import {LocalStore} from "./Store.ts";
import {CliAdapter} from "./SalesforceCli.ts";
import {FeatureManager} from "./FeatureService.ts";
import {UtilityManager} from "./UtilityService.ts";
import type {Principal} from "./domain/types.ts";
const cleanup:Array<()=>void>=[];
afterEach(()=>{for(const close of cleanup.splice(0))close();vi.restoreAllMocks();});
it("binds the cloud destination to verified native identity and retains desktop/feature/org gates without credential transfer",async()=>{
 const folder=NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(),"headful-backup-location-")),store=new LocalStore(folder);
 const orgId="fixture_backup_org",sfOrgId="00D000000000001",userId="005000000000001",username="synthetic@example.com",origin="https://synthetic.my.salesforce.com";
 store.db.prepare("INSERT INTO orgs(id,application_id,label,salesforce_org_id,salesforce_user_id,instance_origin,username,alias,color,agent_enabled,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,1,'connected',1)").run(orgId,orgId,"Synthetic",sfOrgId,userId,origin,username,"fixture","#626dd2");
 const cli=new CliAdapter("fixture-cli-must-never-run"),features=new FeatureManager(store);let enabled=true;
 const gate=vi.spyOn(features,"require").mockImplementation(id=>{expect(id).toBe("headful.admin-utilities/backup");if(!enabled)throw new Error("Fixture backup feature disabled.");});
 const identity=vi.spyOn(cli,"utilityIdentity").mockResolvedValue({orgId:sfOrgId,userId,username,instanceOrigin:origin});
 const utilities=new UtilityManager(store,cli,features);cleanup.push(()=>{utilities.close();store.close();NodeFS.rmSync(folder,{recursive:true,force:true});});
 const principal:Principal={kind:"desktop",user:{id:"local-headful-owner"},orgIds:null,scopes:[]};
 const result=await utilities.handlers["utilities.backup.location"]({orgId},principal);
 expect(result).toEqual({url:`https://headful.cloud/backup?sourceOrg=${sfOrgId}`,executor:"cloud",cloudAuthorization:"required"});expect(gate).toHaveBeenCalledTimes(2);expect(JSON.stringify(result)).not.toMatch(/accessToken|refreshToken|synthetic@example/);
 await expect(utilities.handlers["utilities.backup.location"]({orgId},{...principal,kind:"mcp"})).rejects.toMatchObject({code:"desktop_required"});
 await expect(utilities.handlers["utilities.backup.location"]({orgId},{...principal,orgIds:["another_fixture_org"]})).rejects.toMatchObject({code:"org_missing"});
 identity.mockResolvedValue({orgId:sfOrgId,userId:"005000000000009",username,instanceOrigin:origin});await expect(utilities.handlers["utilities.backup.location"]({orgId},principal)).rejects.toMatchObject({code:"identity_changed"});
 enabled=false;await expect(utilities.handlers["utilities.backup.location"]({orgId},principal)).rejects.toThrow("disabled");
});
