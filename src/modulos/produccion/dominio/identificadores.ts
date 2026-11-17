/** Un texto que no es un UUID no puede ser el id de nada: la base lo rechazaría por formato en lugar de decir «no existe». */
export const FORMA_DE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const esUuid = (texto: string): boolean => FORMA_DE_UUID.test(texto);
