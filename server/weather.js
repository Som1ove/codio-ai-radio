import { config } from './config.js';

const weatherCodeMap = {
  0: '晴',
  1: '大致晴朗',
  2: '局部多云',
  3: '阴',
  45: '有雾',
  48: '雾凇',
  51: '小毛毛雨',
  53: '毛毛雨',
  55: '较强毛毛雨',
  61: '小雨',
  63: '中雨',
  65: '大雨',
  71: '小雪',
  73: '中雪',
  75: '大雪',
  80: '阵雨',
  81: '较强阵雨',
  82: '强阵雨',
  95: '雷雨'
};

const locationAliases = {
  florida: { name: 'Florida', latitude: 27.6648, longitude: -81.5158, country: 'United States' },
  fl: { name: 'Florida', latitude: 27.6648, longitude: -81.5158, country: 'United States' },
  '佛罗里达': { name: 'Florida', latitude: 27.6648, longitude: -81.5158, country: 'United States' },
  miami: { name: 'Miami', latitude: 25.7617, longitude: -80.1918, country: 'United States' },
  orlando: { name: 'Orlando', latitude: 28.5383, longitude: -81.3792, country: 'United States' },
  tampa: { name: 'Tampa', latitude: 27.9506, longitude: -82.4572, country: 'United States' },
  tallahassee: { name: 'Tallahassee', latitude: 30.4383, longitude: -84.2807, country: 'United States' }
};

function normalizeLocationName(city = '') {
  return String(city || '').trim().toLowerCase().replace(/,\s*(fl|florida|usa|us|united states)$/i, '');
}

function resolveKnownLocation(city) {
  return locationAliases[normalizeLocationName(city)] || null;
}

async function getOpenWeather(city) {
  const known = resolveKnownLocation(city);
  const url = new URL('https://api.openweathermap.org/data/2.5/weather');
  if (known) {
    url.searchParams.set('lat', String(known.latitude));
    url.searchParams.set('lon', String(known.longitude));
  } else {
    url.searchParams.set('q', city);
  }
  url.searchParams.set('appid', config.weather.apiKey);
  url.searchParams.set('units', config.weather.units);

  const response = await fetch(url);
  if (!response.ok) throw new Error(`OpenWeather failed: ${response.status}`);
  const data = await response.json();
  return {
    city: known?.name || data.name,
    summary: data.weather?.[0]?.description || '未知',
    temp: Math.round(data.main?.temp),
    feelsLike: Math.round(data.main?.feels_like),
    source: 'openweather'
  };
}

async function geocodeCity(city) {
  const known = resolveKnownLocation(city);
  if (known) return known;

  const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
  url.searchParams.set('name', city);
  url.searchParams.set('count', '1');
  url.searchParams.set('language', 'zh');
  url.searchParams.set('format', 'json');

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Open-Meteo geocoding failed: ${response.status}`);
  const data = await response.json();
  const result = data.results?.[0];
  if (!result) throw new Error(`Open-Meteo cannot find city: ${city}`);
  return result;
}

async function getOpenMeteo(city) {
  const place = await geocodeCity(city);
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(place.latitude));
  url.searchParams.set('longitude', String(place.longitude));
  url.searchParams.set('current', 'temperature_2m,apparent_temperature,weather_code');
  url.searchParams.set('timezone', 'auto');
  url.searchParams.set('temperature_unit', config.weather.units === 'imperial' ? 'fahrenheit' : 'celsius');

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Open-Meteo forecast failed: ${response.status}`);
  const data = await response.json();
  const current = data.current || {};
  const code = Number(current.weather_code);
  return {
    city: place.name,
    summary: weatherCodeMap[code] || '天气未知',
    temp: Math.round(current.temperature_2m),
    feelsLike: Math.round(current.apparent_temperature),
    source: 'open-meteo'
  };
}

export async function getWeather(city = config.weather.city) {
  if (config.weather.apiKey) {
    try {
      return await getOpenWeather(city);
    } catch {
      // Fall through to the no-key provider so one failing service does not break the radio.
    }
  }

  try {
    return await getOpenMeteo(city);
  } catch (error) {
    return {
      city,
      summary: '天气暂不可用',
      temp: null,
      source: 'fallback',
      note: `未配置 OpenWeather key，Open-Meteo 兜底也失败：${error.message}`
    };
  }
}
