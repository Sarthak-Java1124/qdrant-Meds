import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { isSupported, recognizeText } from 'expo-mlkit-ocr';

import { groupRows, type OcrBox } from './prescription';

/** A photo of a prescription, from the camera or the photo library. */
export interface Photo {
  uri: string;
  width: number;
  height: number;
}

/** Long side, in pixels, that a photo is shrunk to before reading: still sharp enough for small print, and fast. */
const MAX_SIDE = 2000;

export const ocrSupported = () => isSupported();

function remove(uri: string) {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // a temporary file that is already gone is fine
  }
}

/**
 * Reads a prescription photo on the phone and returns its text as lines, top to bottom. Apple Vision on iPhone,
 * Google ML Kit on Android. The photo is deleted afterwards: only the text is kept.
 */
export async function readPrescription(photo: Photo): Promise<string[]> {
  if (!isSupported()) throw new Error('This phone cannot read text from photos.');
  const shrunk = Math.max(photo.width, photo.height) > MAX_SIDE;
  let prepared = photo.uri;
  try {
    // re-saving also bakes in the photo's rotation, so the text is read the right way up
    const context = ImageManipulator.manipulate(photo.uri);
    if (shrunk) context.resize(photo.width >= photo.height ? { width: MAX_SIDE } : { height: MAX_SIDE });
    const saved = await (await context.renderAsync()).saveAsync({ format: SaveFormat.JPEG, compress: 0.92 });
    prepared = saved.uri;
    const result = await recognizeText(prepared);
    const boxes: OcrBox[] = result.blocks.flatMap((b) => b.lines).map((l) => ({ text: l.text, ...l.boundingBox }));
    return groupRows(boxes);
  } finally {
    if (prepared !== photo.uri) remove(prepared);
    remove(photo.uri);
  }
}
