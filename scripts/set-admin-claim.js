/*
  Grant or revoke an admin/moderator role (Firebase custom claim).

  Usage (same env as the server, e.g. your .env):
    node scripts/set-admin-claim.js you@example.com                 # make admin
    node scripts/set-admin-claim.js you@example.com --role moderator
    node scripts/set-admin-claim.js <uid> --revoke                  # remove admin and moderator
    node scripts/set-admin-claim.js you@example.com --list          # show current claims

  Claims reach the app on the next ID-token refresh (up to 1 hour, or sign out/in).
  Admins should have a strong password and MFA enabled in Firebase Auth.
*/

const { initializeFirebase, getAuth } = require('../src/config/firebase');

const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith('--'));
const roleIdx = args.indexOf('--role');
const role = roleIdx >= 0 ? args[roleIdx + 1] : 'admin';
const revoke = args.includes('--revoke');
const list = args.includes('--list');

async function main() {
  if (!target) throw new Error('Pass an email or uid. See the usage comment at the top of this file.');
  if (!['admin', 'moderator'].includes(role)) throw new Error('--role must be admin or moderator');

  await initializeFirebase();
  const auth = getAuth();
  const user = target.includes('@') ? await auth.getUserByEmail(target) : await auth.getUser(target);
  const current = user.customClaims || {};

  if (list) {
    console.log(JSON.stringify({ uid: user.uid, email: user.email, claims: current }, null, 2));
    return;
  }

  const next = { ...current };
  if (revoke) {
    delete next.admin;
    delete next.moderator;
  } else {
    next[role] = true;
  }

  await auth.setCustomUserClaims(user.uid, next);
  await auth.revokeRefreshTokens(user.uid); // force a fresh token so the change applies promptly
  console.log(`${revoke ? 'Revoked' : `Granted ${role} to`} ${user.email || user.uid}`);
  console.log(JSON.stringify(next));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
