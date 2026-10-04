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
            const member = await guild.members.fetch({ user: item.userId, force: true }).catch(error => {
              if (item.kind === 'profile' && error.code === 10007) return null;
              throw error;
            });
            const answer = { id: item.id, owner: guild.ownerId === member?.id, permissions: member?.permissions.bitfield.toString() || '0' };
            if (item.kind === 'profile') {
              const user = await client.users.fetch(item.userId, { force: true });
              answer.profile = {
                userId: user.id, name: user.globalName || user.username, username: user.username,
                avatar: user.displayAvatarURL({ size: 256, extension: 'png' }),
                banner: user.bannerURL({ size: 1024, extension: 'png' }) || null,
                roles: member ? member.roles.cache.filter(role => role.id !== guild.id).sort((a, b) => b.position - a.position)
                  .first(12).map(role => ({ name: role.name, color: role.hexColor })) : []
              };
            }
            answers.push(answer);
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
