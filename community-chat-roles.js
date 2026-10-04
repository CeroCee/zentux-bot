// Uses the existing trusted bot channel. No Discord token is shared with the web app.
function startCommunityChatRoles(client, { guildId, request }) {
  let stopped = false;
  let timer;
  async function run(results = []) {
    if (stopped) return;
    try {
      const { requests = [] } = await request({ results });
      const answers = [];
      if (requests.length) {
        const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId);
        // Refresh roles as well as members so removed moderator privileges cannot linger.
        await guild.roles.fetch();
        for (const item of requests) {
          try {
            const member = await guild.members.fetch({ user: item.userId, force: true });
            answers.push({ id: item.id, owner: guild.ownerId === member.id, permissions: member.permissions.bitfield.toString() });
          } catch (error) {
            // Unknown members have no staff permissions. Other Discord failures fail closed.
            answers.push({ id: item.id, owner: false, permissions: '0' });
          }
        }
        await request({ results: answers });
      }
    } catch (error) {
      console.error('Community chat role verification unavailable:', error.code || error.message);
    }
    if (!stopped) timer = setTimeout(run, 1000);
  }
  run();
  return () => { stopped = true; clearTimeout(timer); };
}
module.exports = { startCommunityChatRoles };
