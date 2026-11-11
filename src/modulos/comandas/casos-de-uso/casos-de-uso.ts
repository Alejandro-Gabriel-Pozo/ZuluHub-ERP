import { armarAnularItemEnviado, armarCambiarSalida, armarQuitarSinEnviar } from "./anulaciones";
import type { DependenciasDeComandas } from "./contrato";
import type { DECLARACIONES } from "./declaraciones";
import { armarEnviarACocina, armarPedirQueSalga } from "./envios";
import {
  armarDeclararResultadoDeImpresion,
  armarSolicitarCopia,
  armarSolicitarImpresion,
} from "./impresion";
import {
  armarDesactivarImpresora,
  armarEditarImpresora,
  armarRegistrarImpresora,
} from "./impresoras";

/**
 * Los casos de uso de comandas (E7), listos para que la composición los ofrezca. El `satisfies` exige que sean EXACTAMENTE los que declara
 * `DECLARACIONES`: uno nuevo sin declarar, o una declaración sin caso de uso, no compila.
 */
export function crearCasosDeUsoDeComandas(dependencias: DependenciasDeComandas) {
  return {
    enviarACocina: armarEnviarACocina(dependencias),
    pedirQueSalga: armarPedirQueSalga(dependencias),
    anularItemEnviado: armarAnularItemEnviado(dependencias),
    quitarSinEnviar: armarQuitarSinEnviar(dependencias),
    cambiarSalida: armarCambiarSalida(dependencias),
    registrarImpresora: armarRegistrarImpresora(dependencias),
    editarImpresora: armarEditarImpresora(dependencias),
    desactivarImpresora: armarDesactivarImpresora(dependencias),
    solicitarImpresion: armarSolicitarImpresion(dependencias),
    solicitarCopia: armarSolicitarCopia(dependencias),
    declararResultadoDeImpresion: armarDeclararResultadoDeImpresion(dependencias),
  } satisfies Record<keyof typeof DECLARACIONES, unknown>;
}

export type CasosDeUsoDeComandas = ReturnType<typeof crearCasosDeUsoDeComandas>;
