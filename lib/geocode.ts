import axios from 'axios';

const maptilerKey = process.env.MAPTILER_API_KEY;
const geocodeKey = process.env.GEOCODE_API;

export async function forwardGeocode(query: string) {
  const url = `https://api.maptiler.com/geocoding/${encodeURIComponent(query)}.json?key=${maptilerKey}`;
  const res = await axios.get(url);
  return res.data;
}

export async function reverseGeocode(lat: number, lng: number) {
  const url = `https://api.maptiler.com/geocoding/${lng},${lat}.json?key=${maptilerKey}`;
  const res = await axios.get(url);
  return res.data;
}
