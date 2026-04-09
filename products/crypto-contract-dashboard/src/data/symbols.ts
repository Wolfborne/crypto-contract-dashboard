import type { SymbolConfig } from '../types'

export const SYMBOLS: SymbolConfig[] = [
  { symbol: 'BTCUSDT', label: 'BTC', coingeckoId: 'bitcoin', sector: 'Store of Value' },
  { symbol: 'ETHUSDT', label: 'ETH', coingeckoId: 'ethereum', sector: 'Layer 1' },
  { symbol: 'SOLUSDT', label: 'SOL', coingeckoId: 'solana', sector: 'Layer 1' },
  { symbol: 'BNBUSDT', label: 'BNB', coingeckoId: 'binancecoin', sector: 'Exchange' },
  { symbol: 'XRPUSDT', label: 'XRP', coingeckoId: 'ripple', sector: 'Payments' },
  { symbol: 'DOGEUSDT', label: 'DOGE', coingeckoId: 'dogecoin', sector: 'Meme' },
  { symbol: 'AVAXUSDT', label: 'AVAX', coingeckoId: 'avalanche-2', sector: 'Layer 1' },
  { symbol: 'LINKUSDT', label: 'LINK', coingeckoId: 'chainlink', sector: 'Oracle' }
]
