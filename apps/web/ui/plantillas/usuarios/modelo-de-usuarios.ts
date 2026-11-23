import type { RolDeEmpresa } from "../../../../../src/capacidades/permisos/roles";
import {
  texto,
  type DiccionarioResuelto,
} from "../../../../../src/capacidades/vocabulario/vocabulario";
import { fechaParaMostrar } from "../../../../../src/primitivas/tiempo/fecha-para-mostrar";
import { hoyEnArgentina } from "../../../../../src/primitivas/tiempo/fecha-civil-hasta-hoy";
import type { TonoDeEstado } from "../../componentes/Insignia";
import { rutaDeLaFichaDeUsuario } from "../sesion/rutas-de-cuenta";
import { textoDelRol } from "../sesion/textos-de-empresa";

/**
 * El modelo de «Usuarios» (maqueta `usuarios.html`, `vLista` y `vUsuario`): de lo que entrega el servidor a lo que dibuja la pantalla, con todo el texto ya resuelto. Puro: sin React ni servidor.
 * El orden es el del servidor (email). El estado se dice SIEMPRE con texto (la insignia lleva su texto; el color solo no alcanza). Una invitación vencida se marca por lo que dice el servidor
 * (`vencida`, calculado con su reloj): acá no se vuelve a decidir. El vencimiento llega como instante ISO UTC y se muestra dd/mm/aaaa en la zona de Argentina con la regla de fechas del
 * proyecto (`hoyEnArgentina` + `fechaParaMostrar`): un vencimiento a las 02:00 UTC es todavía el día anterior en Argentina.
 */

/**
 * Lo que entrega el servidor (`src/composicion/usuarios-web.ts`, que la interfaz no importa: las apps entran por `apps/web/servidor`). Misma forma, declarada acá por lo que la pantalla usa:
 * lista blanca de campos, sin sucursales, token ni hash. `venceEn` es un instante ISO UTC.
 */
export type UsuarioParaLaPantalla = Readonly<{
  personaId: string;
  email: string;
  rol: RolDeEmpresa;
  activo: boolean;
}>;

type InvitacionParaLaPantalla = Readonly<{
  invitacionId: string;
  email: string;
  rol: RolDeEmpresa;
  venceEn: string;
  vencida: boolean;
}>;

export type ListaDeUsuariosParaLaPantalla = Readonly<{
  usuarios: readonly UsuarioParaLaPantalla[];
  invitaciones: readonly InvitacionParaLaPantalla[];
}>;

/** Una insignia: el texto del estado y su tono (`null` en `tono` no existe: «Pendiente» es neutra). */
type InsigniaArmada = Readonly<{ tono: TonoDeEstado | "neutro"; texto: string }>;

type FilaDeUsuarioArmada = Readonly<{
  personaId: string;
  email: string;
  /** El rol, traducido. */
  rol: string;
  /** Adónde lleva la fila (la ficha). */
  href: string;
  /** «Desactivado» si la membresía está apagada; `null` si está activa (no se dibuja nada). */
  insignia: InsigniaArmada | null;
}>;

type FilaDeInvitacionArmada = Readonly<{
  invitacionId: string;
  email: string;
  rol: string;
  /** «Vence el 29/11/2026». */
  vence: string;
  /** «Vencida» o «Pendiente». */
  insignia: InsigniaArmada;
}>;

export type ListaDeUsuariosArmada = Readonly<{
  usuarios: readonly FilaDeUsuarioArmada[];
  /** El bloque de invitaciones; `null` si no hay ninguna (no se dibuja ni el encabezado). */
  invitaciones: Readonly<{ encabezado: string; filas: readonly FilaDeInvitacionArmada[] }> | null;
}>;

/** La fecha civil de Argentina del instante, dd/mm/aaaa. Un instante que no se puede leer lanza: falla cerrada, nunca un valor a medias. */
function fechaDeVencimiento(venceEn: string): string {
  const fecha = hoyEnArgentina(new Date(venceEn));
  if (!fecha.ok) throw new RangeError("vencimiento: no es un instante válido");
  return fechaParaMostrar(fecha.valor);
}

function filaDeUsuario(
  u: UsuarioParaLaPantalla,
  diccionario: DiccionarioResuelto,
): FilaDeUsuarioArmada {
  return {
    personaId: u.personaId,
    email: u.email,
    rol: textoDelRol(u.rol, diccionario),
    href: rutaDeLaFichaDeUsuario(u.personaId),
    insignia: u.activo
      ? null
      : { tono: "aviso", texto: texto(diccionario, "catalogo.estado.desactivado") },
  };
}

function filaDeInvitacion(
  i: InvitacionParaLaPantalla,
  diccionario: DiccionarioResuelto,
): FilaDeInvitacionArmada {
  return {
    invitacionId: i.invitacionId,
    email: i.email,
    rol: textoDelRol(i.rol, diccionario),
    vence: texto(diccionario, "usuarios.invitacion.vence_el", {
      fecha: fechaDeVencimiento(i.venceEn),
    }),
    insignia: i.vencida
      ? { tono: "peligro", texto: texto(diccionario, "usuarios.invitacion.vencida") }
      : { tono: "neutro", texto: texto(diccionario, "fiscal.pantalla.config_cartel_pendiente") },
  };
}

/** La lista de usuarios y, debajo, las invitaciones pendientes (solo si hay). */
export function armarLaListaDeUsuarios(
  lista: ListaDeUsuariosParaLaPantalla,
  diccionario: DiccionarioResuelto = {},
): ListaDeUsuariosArmada {
  return {
    usuarios: lista.usuarios.map((u) => filaDeUsuario(u, diccionario)),
    invitaciones:
      lista.invitaciones.length === 0
        ? null
        : {
            encabezado: texto(diccionario, "usuarios.lista.invitaciones"),
            filas: lista.invitaciones.map((i) => filaDeInvitacion(i, diccionario)),
          },
  };
}

/** La ficha de solo lectura de una persona: su email es el título; el rol y el estado, en dos renglones. */
export type FichaDeUsuarioArmada = Readonly<{
  email: string;
  renglones: readonly Readonly<{
    rotulo: string;
    valor: string | null;
    insignia: InsigniaArmada | null;
  }>[];
}>;

export function armarLaFichaDeUsuario(
  u: UsuarioParaLaPantalla,
  diccionario: DiccionarioResuelto = {},
): FichaDeUsuarioArmada {
  return {
    email: u.email,
    renglones: [
      {
        rotulo: texto(diccionario, "usuarios.campo.rol"),
        valor: textoDelRol(u.rol, diccionario),
        insignia: null,
      },
      {
        rotulo: texto(diccionario, "fiscal.pantalla.listado_rotulo_estado"),
        valor: null,
        insignia: u.activo
          ? { tono: "exito", texto: texto(diccionario, "caja.estado.activo") }
          : { tono: "aviso", texto: texto(diccionario, "catalogo.estado.desactivado") },
      },
    ],
  };
}
