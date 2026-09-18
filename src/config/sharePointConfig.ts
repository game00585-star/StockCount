const env=import.meta.env;
export const sharePointConfig={
  tenantId:String(env.VITE_MS_TENANT_ID||'').trim(),
  clientId:String(env.VITE_MS_CLIENT_ID||'').trim(),
  redirectUri:String(env.VITE_MS_REDIRECT_URI||'').trim(),
  hostName:'dfarmcoth.sharepoint.com',sitePath:'/sites/IA',libraryName:'Shared Documents',folderName:'App-Backup',
  scopes:['Files.ReadWrite']
};
export const isSharePointConfigured=()=>Boolean(sharePointConfig.tenantId&&sharePointConfig.clientId&&sharePointConfig.redirectUri);
