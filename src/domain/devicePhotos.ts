export const MAX_DEVICE_PHOTOS = 6;
export const MAX_DEVICE_PHOTO_SIZE = 8 * 1024 * 1024;
export const DEVICE_PHOTO_TYPES = ['image/jpeg', 'image/png'] as const;

type PhotoCandidate = Pick<File, 'name' | 'size' | 'type'>;

export function selectValidDevicePhotos<T extends PhotoCandidate>(
  currentCount: number,
  candidates: T[],
): { accepted: T[]; errors: string[] } {
  const availableSlots = Math.max(0, MAX_DEVICE_PHOTOS - currentCount);
  const errors: string[] = [];
  const valid = candidates.filter((file) => {
    if (!DEVICE_PHOTO_TYPES.includes(file.type as (typeof DEVICE_PHOTO_TYPES)[number])) {
      errors.push(`${file.name}: use uma imagem JPG ou PNG.`);
      return false;
    }
    if (file.size > MAX_DEVICE_PHOTO_SIZE) {
      errors.push(`${file.name}: o tamanho maximo e 8 MB.`);
      return false;
    }
    return true;
  });

  if (valid.length > availableSlots) {
    errors.push(`O limite e de ${MAX_DEVICE_PHOTOS} fotos por aparelho.`);
  }
  return { accepted: valid.slice(0, availableSlots), errors };
}
