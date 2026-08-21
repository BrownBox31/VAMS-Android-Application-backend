async function main() {
  const url = 'http://localhost:3000/uploads/company_b812efd9-a412-4011-9a99-b1d5e3cdae99/audio_resolution/1787220126167_res_voice_1787220122733_dur_3.mp4';
  try {
    const res = await fetch(url, { method: 'HEAD' });
    console.log('Status:', res.status);
    console.log('Headers:');
    res.headers.forEach((value, name) => {
      console.log(`  ${name}: ${value}`);
    });
  } catch (err) {
    console.error('Fetch error:', err);
  }
}
main();
