import { fetchScanText } from '../lib/api.js';
import { parseScanResponse } from '../lib/parseScan.js';
import { useAiRequest } from './useAiRequest.js';

/**
 * Send a photo, get back detected ingredients. Same retry + race-safety as
 * recipes: picking a new photo while one is still being analysed cancels the
 * old request, and its late response is ignored.
 * @param {(result: { items, warnings }, payload: object) => void} onResult
 */
export function useIngredientScan(onResult) {
  return useAiRequest({ send: fetchScanText, parse: parseScanResponse, onResult });
}
