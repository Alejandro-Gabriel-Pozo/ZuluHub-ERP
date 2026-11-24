import { ROLES_DE_EMPRESA, type RolDeEmpresa } from "../../../../../src/capacidades/permisos/roles";
import {
  texto,
  type DiccionarioResuelto,
} from "../../../../../src/capacidades/vocabulario/vocabulario";
import { RUTAS_DE_CUENTA } from "../sesion/rutas-de-cuenta";
import { textoDelRol } from "../sesion/textos-de-empresa";
import { fechaDeVencimiento } from "./modelo-de-usuarios";

/**
 * El modelo de invitar, reenviar y revocar (maqueta `usuarios.html`, `vInvitar` y `vInvitacion`; tramo U2): de lo que entrega el servidor a lo que dibujan las pantallas, con todo el texto ya
 * resuelto. Puro: sin React ni servidor. Los roles que se ofrecen son los de la empresa MENOS Gerente (el gerente no se invita, se traspasa), en el orden de la maqueta (Administrador y Empleado).
 * Una regla, un lugar: la lista de roles sale de `ROLES_DE_EMPRESA`; esto solo la filtra y no la copia.
 */

/** Las sucursales activas de la empresa tal como las entrega el servidor. */
export type SucursalParaElegir = Readonly<{ id: string; nombre: string }>;

export type RolInvitable = Exclude<RolDeEmpresa, "GERENTE">;

const ROLES_INVITABLES: readonly RolInvitable[] = ROLES_DE_EMPRESA.filter(
  (r): r is RolInvitable => r !== "GERENTE",
);

/** El rol con el que nace el formulario: el de menor alcance (SUPUESTO, DEC-0852: lo propone el plan; revertirlo es cambiar esta constante). */
export const ROL_INICIAL_DE_LA_INVITACION: RolInvitable = "OPERADOR";

/** El rol que pide las sucursales (el administrador trabaja en todas, plan §3). */
export const ROL_CON_SUCURSALES: RolInvitable = "OPERADOR";

export type FormularioDeInvitacionArmado = Readonly<{
  textos: Readonly<{
    email: string;
    rol: string;
    sucursales: string;
    enviar: string;
    cancelar: string;
    /** El aviso informativo: ya había una invitación vigente, quedó la que estaba. */
    yaHabia: string;
  }>;
  roles: readonly Readonly<{ valor: RolInvitable; etiqueta: string }>[];
  sucursales: readonly SucursalParaElegir[];
}>;

export function armarElFormularioDeInvitacion(
  sucursales: readonly SucursalParaElegir[],
  diccionario: DiccionarioResuelto = {},
): FormularioDeInvitacionArmado {
  return {
    textos: {
      email: texto(diccionario, "clientes.formulario.email"),
      rol: texto(diccionario, "usuarios.campo.rol"),
      sucursales: texto(diccionario, "usuarios.campo.sucursales"),
      enviar: texto(diccionario, "usuarios.invitar.enviar"),
      cancelar: texto(diccionario, "fiscal.pantalla.config_pv_cancelar"),
      yaHabia: texto(diccionario, "usuarios.invitar.ya_habia"),
    },
    roles: ROLES_INVITABLES.map((valor) => ({ valor, etiqueta: textoDelRol(valor, diccionario) })),
    sucursales,
  };
}

/** Lo que entrega el servidor de una invitación pendiente (`src/composicion/usuarios-web.ts`, que la interfaz no importa). `venceEn` es un instante ISO UTC; `sucursales`, los ids a los que se invitó. */
export type InvitacionParaLaFichaDeLaPantalla = Readonly<{
  invitacionId: string;
  email: string;
  rol: RolDeEmpresa;
  venceEn: string;
  vencida: boolean;
  sucursales: readonly string[];
}>;

export type FichaDeInvitacionArmada = Readonly<{
  /** El email es el título de la pantalla (lo pone la página). */
  email: string;
  renglones: readonly Readonly<{
    rotulo: string;
    valor: string | null;
    insignia: Readonly<{ tono: "peligro" | "neutro"; texto: string }> | null;
  }>[];
  /** «Vence el 29/11/2026», dd/mm/aaaa en hora de Argentina. */
  vence: string;
  reenviar: string;
  revocar: string;
  /** Adónde vuelve la pantalla al revocar. */
  rutaDeLaLista: string;
}>;

/**
 * La ficha de una invitación: rol, sucursales (por nombre; una desactivada ya no figura, plan §4, y sin ninguna, un guion), estado y vencimiento. El estado se dice SIEMPRE con texto: «Vencida» o
 * «Pendiente» (el que ya usa la lista). La lista de nombres sale de las sucursales activas de la empresa: un id que no está entre ellas (desactivada) no se nombra.
 */
export function armarLaFichaDeInvitacion(
  invitacion: InvitacionParaLaFichaDeLaPantalla,
  sucursalesDeLaEmpresa: readonly SucursalParaElegir[],
  diccionario: DiccionarioResuelto = {},
): FichaDeInvitacionArmada {
  const nombres = sucursalesDeLaEmpresa
    .filter((s) => invitacion.sucursales.includes(s.id))
    .map((s) => s.nombre);
  return {
    email: invitacion.email,
    renglones: [
      {
        rotulo: texto(diccionario, "usuarios.campo.rol"),
        valor: textoDelRol(invitacion.rol, diccionario),
        insignia: null,
      },
      {
        rotulo: texto(diccionario, "usuarios.campo.sucursales"),
        valor: nombres.length === 0 ? "—" : nombres.join(", "),
        insignia: null,
      },
      {
        rotulo: texto(diccionario, "fiscal.pantalla.listado_rotulo_estado"),
        valor: null,
        insignia: invitacion.vencida
          ? { tono: "peligro", texto: texto(diccionario, "usuarios.invitacion.vencida") }
          : {
              tono: "neutro",
              texto: texto(diccionario, "fiscal.pantalla.config_cartel_pendiente"),
            },
      },
    ],
    vence: texto(diccionario, "usuarios.invitacion.vence_el", {
      fecha: fechaDeVencimiento(invitacion.venceEn),
    }),
    reenviar: texto(diccionario, "usuarios.invitacion.reenviar"),
    revocar: texto(diccionario, "usuarios.invitacion.revocar"),
    rutaDeLaLista: RUTAS_DE_CUENTA.usuarios,
  };
}
