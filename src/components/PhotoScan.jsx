import { useEffect, useRef, useState } from 'react';
import { useIngredientScan } from '../hooks/useIngredientScan.js';
import { prepareImage } from '../lib/image.js';
import { describeError } from '../lib/errors.js';
import { itemsToText } from '../lib/parseScan.js';
import { useElapsed } from './LoadingState.jsx';
import { ErrorDetails } from './ErrorState.jsx';

/**
 * "Scan a photo" → the AI lists ingredients it can see → the user confirms
 * which ones to add to the text box. Nothing is added without confirmation,
 * because vision models do misidentify things (and low-confidence guesses
 * start unticked).
 */
export default function PhotoScan({ ingredientsText, onAdd, fault }) {
  const [photo, setPhoto] = useState(null); // { previewUrl, mimeType, data }
  const [preparing, setPreparing] = useState(false);
  const [prepError, setPrepError] = useState(null);
  const [result, setResult] = useState(null); // { items, warnings }
  const [selected, setSelected] = useState({});
  const prepIdRef = useRef(0);

  const scan = useIngredientScan((res) => {
    setResult(res);
    setSelected(Object.fromEntries(res.items.map((i) => [i.id, i.confidence !== 'low'])));
  });
  const elapsed = useElapsed(scan.isLoading ? scan.startedAt : null);

  // Free the preview's object URL when it's replaced or on unmount.
  useEffect(() => () => photo && URL.revokeObjectURL(photo.previewUrl), [photo]);

  const clear = () => {
    prepIdRef.current++;
    scan.reset();
    setPhoto(null);
    setPreparing(false);
    setPrepError(null);
    setResult(null);
  };

  const onFile = async (file) => {
    if (!file) return;
    clear();
    const prepId = prepIdRef.current;
    setPreparing(true);
    try {
      const prepared = await prepareImage(file);
      if (prepId !== prepIdRef.current) {
        URL.revokeObjectURL(prepared.previewUrl); // user picked another photo meanwhile
        return;
      }
      setPhoto(prepared);
      setPreparing(false);
      scan.run({ mimeType: prepared.mimeType, data: prepared.data }, { fault });
    } catch (err) {
      if (prepId !== prepIdRef.current) return;
      setPreparing(false);
      setPrepError(describeError(err));
    }
  };

  const add = () => {
    const text = itemsToText(result.items.filter((i) => selected[i.id]), ingredientsText);
    if (text) onAdd(text);
    clear();
  };

  const active = photo || preparing || prepError;
  if (!active) {
    return (
      <FilePicker onFile={onFile} className="btn btn-ghost btn-block scan-btn">
        <span aria-hidden="true">📷</span> Scan a photo of your fridge
      </FilePicker>
    );
  }

  const error = prepError || (scan.status === 'error' ? scan.error : null);
  const chosenCount = result ? result.items.filter((i) => selected[i.id]).length : 0;

  return (
    <div className="scan-panel" aria-live="polite">
      <div className="scan-head">
        {photo && <img className="scan-thumb" src={photo.previewUrl} alt="Your photo" />}
        <div className="scan-status">
          {preparing && <Status>Preparing photo…</Status>}
          {scan.isLoading && (
            <Status>
              {scan.attempt > 1 ? 'First answer was unusable — asking again…' : elapsed >= 8 ? 'Still looking — this one is taking a while…' : 'Looking for ingredients…'} {elapsed}s
            </Status>
          )}
          {error && <strong>{error.title}</strong>}
          {scan.status === 'refused' && <span>{scan.refusal}</span>}
          {result && result.items.length === 0 && <span>Didn't spot any ingredients. Try a closer, brighter photo.</span>}
          {result && result.items.length > 0 && <span>Found {result.items.length}. Untick anything that's wrong:</span>}
        </div>
        <button type="button" className="btn btn-ghost icon-btn" onClick={clear} aria-label="Discard photo">
          ×
        </button>
      </div>

      {error && (
        <>
          {error.message && <p className="small muted scan-msg">{error.message}</p>}
          <div className="scan-actions">
            {!prepError && (
              <button type="button" className="btn btn-primary" onClick={scan.retry}>
                Try again
              </button>
            )}
            <FilePicker onFile={onFile} className="btn btn-ghost">
              Choose another photo
            </FilePicker>
          </div>
          <ErrorDetails error={error} />
        </>
      )}

      {(scan.status === 'refused' || result?.items.length === 0) && (
        <div className="scan-actions">
          <FilePicker onFile={onFile} className="btn btn-ghost">
            Choose another photo
          </FilePicker>
        </div>
      )}

      {result && result.items.length > 0 && (
        <>
          <div className="chips" role="group" aria-label="Ingredients found in photo">
            {result.items.map((item) => (
              <label key={item.id} className={`chip ${selected[item.id] ? 'chip-on' : ''} ${item.confidence === 'low' ? 'chip-unsure' : ''}`}>
                <input type="checkbox" checked={Boolean(selected[item.id])} onChange={() => setSelected((s) => ({ ...s, [item.id]: !s[item.id] }))} />
                {item.name}
                {item.amount && <span className="chip-meta">{item.amount}</span>}
                {item.confidence === 'low' && (
                  <span className="chip-meta" title="The AI isn't sure about this one">
                    unsure?
                  </span>
                )}
              </label>
            ))}
          </div>
          {result.warnings.map((w) => (
            <p key={w} className="small warn-text scan-msg">
              {w}
            </p>
          ))}
          <div className="scan-actions">
            <button type="button" className="btn btn-primary" onClick={add} disabled={chosenCount === 0}>
              Add {chosenCount} to my list
            </button>
            <FilePicker onFile={onFile} className="btn btn-ghost">
              Another photo
            </FilePicker>
          </div>
        </>
      )}

      {scan.isLoading && (
        <div className="scan-actions">
          <button type="button" className="btn btn-ghost" onClick={clear}>
            Cancel
          </button>
        </div>
      )}

      <p className="help">Photos are shrunk in your browser and sent to the AI provider for analysis. They aren't stored.</p>
    </div>
  );
}

function Status({ children }) {
  return (
    <span className="scan-loading" role="status">
      <span className="spinner spinner-sm" aria-hidden="true" /> {children}
    </span>
  );
}

/** A button-looking label wrapping a hidden file input (works with keyboard and on mobile). */
function FilePicker({ onFile, className, children }) {
  return (
    <label className={`file-picker ${className}`}>
      {children}
      <input
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(e) => {
          onFile(e.target.files?.[0]);
          e.target.value = ''; // allow choosing the same file again
        }}
      />
    </label>
  );
}
