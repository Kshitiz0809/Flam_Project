import { fetchRecipeText } from '../lib/api.js';
import { parseRecipeResponse } from '../lib/parseRecipe.js';
import { useAiRequest } from './useAiRequest.js';

/**
 * Generate / refine a recipe. See useAiRequest for retry + race-safety.
 * @param {(result: { recipe, warnings }, payload: object) => void} onResult
 */
export function useRecipeGenerator(onResult) {
  return useAiRequest({ send: fetchRecipeText, parse: parseRecipeResponse, onResult });
}
