import type { Generated } from "kysely";

/**
 * Las tablas de comandas (0038, E7). Los decimales llegan como TEXTO (`numeric` de Postgres): nunca se pasan por `number` (ADR-006).
 * `fecha_negocio` es un `date` que se LEE siempre como texto (`::text`). Un test compara estas columnas con el catálogo de la base
 * (`comandas-persistencia.test.ts`).
 */
export type ComandasDb = {
  contador_de_envios: {
    empresa_id: string;
    cuenta_id: string;
    ultimo: Generated<number>;
    creado_en: Generated<Date>;
    actualizado_en: Generated<Date>;
    version: Generated<number>;
  };
  envio_de_comanda: {
    id: string;
    empresa_id: string;
    sucursal_id: string;
    cuenta_id: string;
    numero: number;
    tipo: "ENVIO" | "SALIDA_PEDIDA";
    rotulo: string;
    enviado_por: string;
    enviado_en: Date;
    fecha_negocio: Generated<string>;
    clave: string;
    huella: string;
    creado_en: Generated<Date>;
  };
  renglon_de_envio: {
    empresa_id: string;
    envio_id: string;
    orden: number;
    linea_id: string;
    cantidad: string;
    rol: "SALE" | "ESPERA";
    nombre_de_cocina: string;
    detalle_de_cocina: string[];
    creado_en: Generated<Date>;
  };
  linea_de_comanda: {
    empresa_id: string;
    linea_id: string;
    cuenta_id: string;
    salida: Generated<"AHORA" | "DESPUES">;
    envio_id: string | null;
    creado_en: Generated<Date>;
    actualizado_en: Generated<Date>;
    version: Generated<number>;
  };
  aviso_de_anulacion: {
    id: string;
    empresa_id: string;
    cuenta_id: string;
    linea_origen_id: string;
    envio_id: string;
    cantidad: string;
    quedan: string;
    motivo: string;
    nombre_de_cocina: string;
    detalle_de_cocina: string[];
    rotulo: string;
    anulado_por: string;
    anulado_en: Date;
    creado_en: Generated<Date>;
  };
  impresora: {
    id: string;
    empresa_id: string;
    sucursal_id: string;
    nombre: string;
    uso: "COMANDA" | "TICKET";
    papel_mm: number;
    activa: Generated<boolean>;
    creada_por: string;
    creada_en: Date;
    creado_en: Generated<Date>;
    actualizado_en: Generated<Date>;
    version: Generated<number>;
  };
  trabajo_de_impresion: {
    id: string;
    empresa_id: string;
    sucursal_id: string;
    impresora_id: string | null;
    documento_tipo: "COMANDA" | "ANULACION" | "TICKET";
    documento_id: string;
    es_copia: Generated<boolean>;
    estado: Generated<"PENDIENTE" | "IMPRESA" | "FALLIDA">;
    intentos: Generated<number>;
    clave: string;
    huella: string;
    solicitado_por: string;
    solicitado_en: Date;
    creado_en: Generated<Date>;
    actualizado_en: Generated<Date>;
    version: Generated<number>;
  };
  intento_de_impresion: {
    empresa_id: string;
    trabajo_id: string;
    numero: number;
    resultado: "IMPRESA" | "FALLIDA";
    declarado_por: string;
    declarado_en: Date;
    creado_en: Generated<Date>;
  };
};

/** Tablas y columnas del módulo, en el orden de la base; un test las compara con el catálogo. */
export const COLUMNAS_DE_COMANDAS = {
  contador_de_envios: [
    "empresa_id",
    "cuenta_id",
    "ultimo",
    "creado_en",
    "actualizado_en",
    "version",
  ],
  envio_de_comanda: [
    "id",
    "empresa_id",
    "sucursal_id",
    "cuenta_id",
    "numero",
    "tipo",
    "rotulo",
    "enviado_por",
    "enviado_en",
    "fecha_negocio",
    "clave",
    "huella",
    "creado_en",
  ],
  renglon_de_envio: [
    "empresa_id",
    "envio_id",
    "orden",
    "linea_id",
    "cantidad",
    "rol",
    "nombre_de_cocina",
    "detalle_de_cocina",
    "creado_en",
  ],
  linea_de_comanda: [
    "empresa_id",
    "linea_id",
    "cuenta_id",
    "salida",
    "envio_id",
    "creado_en",
    "actualizado_en",
    "version",
  ],
  aviso_de_anulacion: [
    "id",
    "empresa_id",
    "cuenta_id",
    "linea_origen_id",
    "envio_id",
    "cantidad",
    "quedan",
    "motivo",
    "nombre_de_cocina",
    "detalle_de_cocina",
    "rotulo",
    "anulado_por",
    "anulado_en",
    "creado_en",
  ],
  impresora: [
    "id",
    "empresa_id",
    "sucursal_id",
    "nombre",
    "uso",
    "papel_mm",
    "activa",
    "creada_por",
    "creada_en",
    "creado_en",
    "actualizado_en",
    "version",
  ],
  trabajo_de_impresion: [
    "id",
    "empresa_id",
    "sucursal_id",
    "impresora_id",
    "documento_tipo",
    "documento_id",
    "es_copia",
    "estado",
    "intentos",
    "clave",
    "huella",
    "solicitado_por",
    "solicitado_en",
    "creado_en",
    "actualizado_en",
    "version",
  ],
  intento_de_impresion: [
    "empresa_id",
    "trabajo_id",
    "numero",
    "resultado",
    "declarado_por",
    "declarado_en",
    "creado_en",
  ],
} as const;
