import { describe, it, expect } from 'vitest';
import { parseYoutubeId } from '../src/services/youtube.js';
import { pickTrailer } from '../src/services/igdb.js';

describe('parseYoutubeId', () => {
  it.each([
    ['dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s', 'dQw4w9WgXcQ'],
    ['youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ?si=abc', 'dQw4w9WgXcQ'],
    ['https://m.youtube.com/shorts/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
  ])('reads %s', (input, id) => {
    expect(parseYoutubeId(input)).toBe(id);
  });

  it.each(['', 'not a link', 'https://vimeo.com/123456', 'https://youtube.com/watch?v=short'])(
    'rejects %s',
    (input) => {
      expect(parseYoutubeId(input)).toBeNull();
    },
  );
});

describe('pickTrailer', () => {
  it('prefers the launch trailer over other trailers', () => {
    const videos = [
      { name: 'Announcement Trailer', video_id: 'announce001' },
      { name: 'Launch Trailer', video_id: 'launch00001' },
    ];
    expect(pickTrailer(videos)).toBe('launch00001');
  });

  it('accepts any trailer when there is no launch/official one', () => {
    expect(pickTrailer([{ name: 'Story Trailer', video_id: 'story000001' }])).toBe('story000001');
  });

  it('never picks something that is not confidently a trailer', () => {
    const videos = [
      { name: 'Gameplay Walkthrough', video_id: 'walkthrough' },
      { name: 'Teaser Trailer', video_id: 'teaser00001' },
      { name: 'Developer Interview', video_id: 'interview01' },
    ];
    expect(pickTrailer(videos)).toBeNull();
    expect(pickTrailer(undefined)).toBeNull();
  });
});
