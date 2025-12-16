import './style.css';
import videojs from 'video.js';
import './tech/MkvWasmTech.js';

const player = videojs('my-player', {
  techOrder: ['MkvWasm'], // Force use of our custom tech
  sources: [{
    src: 'https://pub-6b25c191839c4b01a878de4fdde0227b.r2.dev/8d8118cffa904fe68b8c02f562c36160?token=1765856945',
    // src: '/test5.mkv',
    // src: "https://0.ios37.workers.dev/ec86f8d15aed59884492ded48419adfa/driveseed.org/The.Fantastic.Four.First.Steps.2025.Imax.1080P.10bit.Web-Dl.Hindi.English.Msubs.MoviesMod.plus.mkv",
    type: 'video/x-matroska'
  }]
});

// Handle Playback manually if Video.js fails to bridge the event
// Handle Playback manually if Video.js fails to bridge the event
player.ready(() => {
  console.log('Player Ready');

  // Audio Track Switching UI (Standard Video.js)
  const audioTrackList = player.audioTracks();
  audioTrackList.on('change', function () {
    console.log('Audio track changed');
    // The Tech handles the switch internally upon receiving the event or querying the active track
  });
});

// Debug: Force Play Button (Global)
const btn = document.createElement('button');
btn.innerText = 'FORCE PLAY';
btn.style.position = 'fixed';
btn.style.top = '10px';
btn.style.left = '10px';
btn.style.zIndex = '9999';
btn.style.padding = '10px 20px';
btn.style.background = 'red';
btn.style.color = 'white';
btn.onclick = () => {
  console.log('Force Play Clicked');
  const tech = player.tech({ IWillNotUseThisInPlugins: true });
  if (tech && tech.play) {
    console.log('Calling tech.play() DIRECTLY');
    tech.play();
  } else {
    console.error('Tech not found or no play method');
  }
};
document.body.appendChild(btn);

player.on('error', (e) => {
  console.error('Player Error:', player.error());
});
