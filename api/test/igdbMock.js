import nock from 'nock';

// Stub the Twitch OAuth token endpoint.
export function mockToken({ expiresIn = 5000000 } = {}) {
  return nock('https://id.twitch.tv')
    .post('/oauth2/token')
    .query(true)
    .reply(200, { access_token: 'fake-token', expires_in: expiresIn, token_type: 'bearer' });
}

// Stub the IGDB /games endpoint. `responder` receives the apicalypse body and
// returns the rows to send back.
export function mockGames(responder) {
  return nock('https://api.igdb.com')
    .post('/v4/games')
    .reply((uri, body) => [200, responder(String(body))]);
}

export function cleanAll() {
  nock.cleanAll();
}
