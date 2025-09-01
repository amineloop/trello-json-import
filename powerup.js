/* global TrelloPowerUp */
const Promise = TrelloPowerUp.Promise;

// Register capabilities for the Power-Up
TrelloPowerUp.initialize({
  'board-buttons': function (t, opts) {
    return [{
      icon: 'https://amineloop.github.io/trello-json-import/icon.png',
      text: 'Import CSV/JSON',
      callback: function (t) {
        return t.popup({
          title: 'Import CSV/JSON',
          url: 'https://amineloop.github.io/trello-json-import/import.html',
          height: 420,
        });
      }
    }];
  },

  // Optional: show auth status on Power-Up menu
  'authorization-status': async function (t, options) {
    const token = await t.get('member', 'private', 'trello_token');
    return { authorized: !!token };
  },

  'show-authorization': function (t, options) {
    return t.popup({
      title: 'Authorize',
      url: './import.html#auth',
      height: 300,
    });
  },
}, { appKey: null }); // appKey not required here; we handle it in UI
