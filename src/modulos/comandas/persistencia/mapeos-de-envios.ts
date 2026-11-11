import type { PersonaId } from "../../../primitivas/identificadores/marca";
import type { RolDeRenglon, TipoDeEnvio } from "../dominio/envio";
import type { Envio, Renglon } from "./contrato-de-envios";

export type FilaEnvio = {
  id: string;
  sucursal_id: string;
  cuenta_id: string;
  numero: number;
  tipo: TipoDeEnvio;
  rotulo: string;
  enviado_por: string;
  enviado_en: Date;
  fecha_negocio: string;
  clave: string;
  huella: string;
};

export const aEnvio = (f: FilaEnvio): Envio => ({
  id: f.id,
  sucursalId: f.sucursal_id,
  cuentaId: f.cuenta_id,
  numero: f.numero,
  tipo: f.tipo,
  rotulo: f.rotulo,
  enviadoPor: f.enviado_por as PersonaId,
  enviadoEn: f.enviado_en,
  fechaNegocio: f.fecha_negocio,
  clave: f.clave,
  huella: f.huella,
});

export const aRenglon = (f: {
  orden: number;
  linea_id: string;
  cantidad: string;
  rol: RolDeRenglon;
  nombre_de_cocina: string;
  detalle_de_cocina: string[];
}): Renglon => ({
  orden: f.orden,
  lineaId: f.linea_id,
  cantidad: f.cantidad,
  rol: f.rol,
  nombreDeCocina: f.nombre_de_cocina,
  detalleDeCocina: f.detalle_de_cocina,
});
