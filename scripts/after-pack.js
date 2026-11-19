'use strict';
// electron-builder afterPack hook: set the Windows exe icon + version info with resedit (pure JS, no Wine needed).
const fs = require('fs');
const path = require('path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const ResEdit = require('resedit');
  const info = context.packager.appInfo;
  const exePath = path.join(context.appOutDir, `${info.productFilename}.exe`);
  const icoPath = path.join(__dirname, '..', 'build', 'icon.ico');
  const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
  const res = ResEdit.NtExecutableResource.from(exe);
  const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(icoPath));
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
  const groupId = groups.length ? groups[0].id : 1;
  const lang = groups.length ? groups[0].lang : 1033;
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, groupId, lang, iconFile.icons.map((i) => i.data));
  const vis = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
  const vi = vis.length ? vis[0] : ResEdit.Resource.VersionInfo.createEmpty();
  const [a, b, c] = String(info.version).split('.').map((x) => parseInt(x, 10) || 0);
  vi.setFileVersion(a, b, c, 0, 1033);
  vi.setProductVersion(a, b, c, 0, 1033);
  const langs = vi.getAllLanguagesForStringValues();
  const target = langs.length ? langs[0] : { lang: 1033, codepage: 1200 };
  vi.setStringValues(target, {
    ProductName: info.productName,
    FileDescription: info.productName,
    CompanyName: info.companyName || '5 Dollar Friday',
    LegalCopyright: `Copyright © ${new Date().getFullYear()} ${info.companyName || '5 Dollar Friday'}`,
    OriginalFilename: `${info.productFilename}.exe`,
    InternalName: info.productFilename,
    FileVersion: info.version,
    ProductVersion: info.version,
  });
  vi.outputToResourceEntries(res.entries);
  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));
  console.log(`  • set icon + version info on ${path.basename(exePath)}`);
};
