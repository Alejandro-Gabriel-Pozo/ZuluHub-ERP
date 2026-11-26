import { CATALOGO_DE_TEXTOS } from "../../../../../src/capacidades/vocabulario/catalogo";
import {
  texto,
  type DiccionarioResuelto,
} from "../../../../../src/capacidades/vocabulario/vocabulario";
import { claveDelNombreDeLaAccion } from "../../../../../src/capacidades/vocabulario/nombre-de-la-accion";
import type { TonoDeEstado } from "../../componentes/Insignia";
import { RUTAS_DE_CUENTA, rutaDeLaFichaDeRol } from "../sesion/rutas-de-cuenta";

/**
 * El modelo de «Roles»: de lo que entrega el servidor a lo que dibuja la pantalla, con todo el texto ya resuelto. Puro: sin React ni servidor. Los permisos no se replican: la lista ofrece «Nuevo rol» solo a quien
 * puede crear y la ficha «Archivar» o «Reactivar» solo a quien puede editar (la oferta de cada acción la calcula el servidor); lo que decide de verdad es el caso de uso al enviar.
 */

/** Lo que entrega el servidor (`src/composicion/roles-web.ts`, que la interfaz no importa: las apps entran por `apps/web/servidor`). Misma forma, declarada acá por lo que la pantalla usa. */
export type RolParaLaPantalla = Readonly<{
  rolId: string;
  nombre: string;
  /** `false`: archivado (no se asigna ni otorga acciones). */
  activo: boolean;
  personasActivas: number;
  /** La `version` de la fila: control optimista de la edición. */
  version: number;
  acciones: readonly string[];
}>;

export type ModuloParaElegir = Readonly<{
  modulo: string;
  enElPlan: boolean;
  acciones: readonly Readonly<{
    accion: string;
    piso: "SOLO_GERENTE" | "TODOS_LOS_ROLES" | null;
  }>[];
}>;

/**
 * El nombre que ve el gerente para una acción del catálogo (clave `roles.accion.<id>`). Una acción sin nombre es un error de programación y no se disfraza con el id: falla (la prueba
 * `catalogo-de-acciones.test.ts` lo atrapa antes, para las del catálogo).
 */
export function textoDeLaAccion(diccionario: DiccionarioResuelto, accion: string): string {
  const clave = claveDelNombreDeLaAccion(accion);
  if (!Object.hasOwn(CATALOGO_DE_TEXTOS, clave)) {
    throw new RangeError(`La acción «${accion}» no tiene nombre en el catálogo de textos.`);
  }
  return texto(diccionario, clave as keyof typeof CATALOGO_DE_TEXTOS);
}

type InsigniaArmada = Readonly<{ tono: TonoDeEstado | "neutro"; texto: string }>;

export type ListaDeRolesArmada = Readonly<{
  /** «Nuevo rol»: `null` si quien mira no puede crear (no se dibuja). */
  nuevo: Readonly<{ texto: string; href: string }> | null;
  /** «Todavía no hay roles propios»: solo cuando no hay ninguno. */
  vacia: string | null;
  filas: readonly Readonly<{
    rolId: string;
    nombre: string;
    href: string;
    personas: string;
    insignia: InsigniaArmada | null;
  }>[];
}>;

/** La lista de roles propios, en el orden del servidor (nombre). El archivado lleva su insignia con texto: el estado nunca se dice solo con el color. */
export function armarLaListaDeRoles(
  roles: readonly RolParaLaPantalla[],
  diccionario: DiccionarioResuelto,
  puedeCrear: boolean,
): ListaDeRolesArmada {
  return {
    nuevo: puedeCrear
      ? { texto: texto(diccionario, "roles.lista.nuevo"), href: RUTAS_DE_CUENTA.nuevoRol }
      : null,
    vacia: roles.length === 0 ? texto(diccionario, "roles.lista.vacia") : null,
    filas: roles.map((r) => ({
      rolId: r.rolId,
      nombre: r.nombre,
      href: rutaDeLaFichaDeRol(r.rolId),
      personas:
        r.personasActivas === 1
          ? texto(diccionario, "roles.lista.persona")
          : texto(diccionario, "roles.lista.personas", { n: String(r.personasActivas) }),
      insignia: r.activo
        ? null
        : { tono: "neutro", texto: texto(diccionario, "roles.estado.archivado") },
    })),
  };
}

type OpcionArmada = Readonly<{
  id: string;
  etiqueta: string;
  nota?: string | undefined;
  deshabilitada?: boolean;
}>;

export type FormularioDeAltaDeRolArmado = Readonly<{
  nombre: string;
  origen: Readonly<{ rotulo: string; opciones: readonly OpcionArmada[] }>;
  /** Los roles activos que se pueden copiar (`null`: no hay ninguno y la opción «Copiar de otro rol» no se ofrece). */
  copiarDe: Readonly<{ rotulo: string; opciones: readonly OpcionArmada[] }> | null;
  guardar: string;
  cancelar: string;
}>;

/** El formulario de «Nuevo rol»: nombre y de dónde empieza. Las acciones se eligen en la ficha, ya con el rol creado. */
export function armarElFormularioDeAlta(
  rolesParaCopiar: readonly Readonly<{ rolId: string; nombre: string }>[],
  diccionario: DiccionarioResuelto,
): FormularioDeAltaDeRolArmado {
  const copiable = rolesParaCopiar.length > 0;
  return {
    nombre: texto(diccionario, "caja.campo.nombre"),
    origen: {
      rotulo: texto(diccionario, "roles.formulario.origen"),
      opciones: [
        { id: "VACIO", etiqueta: texto(diccionario, "roles.formulario.origen_vacio") },
        {
          id: "PLANTILLA:ADMINISTRADOR",
          etiqueta: texto(diccionario, "rol.administrador.nombre"),
        },
        { id: "PLANTILLA:OPERADOR", etiqueta: texto(diccionario, "rol.operador.nombre") },
        ...(copiable
          ? [{ id: "ROL", etiqueta: texto(diccionario, "roles.formulario.origen_rol") }]
          : []),
      ],
    },
    copiarDe: copiable
      ? {
          rotulo: texto(diccionario, "roles.formulario.origen_rol"),
          opciones: rolesParaCopiar.map((r) => ({ id: r.rolId, etiqueta: r.nombre })),
        }
      : null,
    guardar: texto(diccionario, "caja.accion.guardar"),
    cancelar: texto(diccionario, "caja.accion.cancelar"),
  };
}

export type FichaDeRolArmada = Readonly<{
  nombre: string;
  nombreInicial: string;
  activo: boolean;
  insignia: InsigniaArmada | null;
  queHace: Readonly<{
    rotulo: string;
    grupos: readonly Readonly<{
      modulo: string;
      nombre: string;
      opciones: readonly OpcionArmada[];
    }>[];
    /** Las acciones tildadas al abrir (las del rol más las que todo rol lleva). */
    marcadas: readonly string[];
  }>;
  guardar: string;
  cancelar: string;
  /** «Archivar» (rol activo) o «Reactivar» (archivado): `null` si quien mira no puede. */
  archivar: string | null;
  reactivar: string | null;
}>;

/**
 * La ficha de un rol propio: su nombre y, por módulo, una casilla por acción. Una acción con piso «solo el gerente» se muestra cerrada con «Solo el gerente»; las de un módulo que el plan no incluye, cerradas con «No incluida en el plan»;
 * las que todo rol lleva van tildadas y cerradas. Lo cerrado no se puede cambiar acá y el servidor lo vuelve a validar al guardar.
 */
export function armarLaFichaDeRol(
  rol: RolParaLaPantalla,
  modulos: readonly ModuloParaElegir[],
  diccionario: DiccionarioResuelto,
  ofertas: Readonly<{ editar: boolean }>,
): FichaDeRolArmada {
  const tiene = new Set(rol.acciones);
  const marcadas: string[] = [];
  const grupos = modulos
    .filter((m) => m.acciones.length > 0)
    .map((m) => ({
      modulo: m.modulo,
      nombre: texto(diccionario, `roles.modulo.${m.modulo}` as keyof typeof CATALOGO_DE_TEXTOS),
      opciones: m.acciones.map(({ accion, piso }): OpcionArmada => {
        if (piso === "TODOS_LOS_ROLES") marcadas.push(accion);
        else if (m.enElPlan && piso === null && tiene.has(accion)) marcadas.push(accion);
        const nota =
          piso === "SOLO_GERENTE"
            ? texto(diccionario, "roles.accion_nota.solo_gerente")
            : m.enElPlan
              ? undefined
              : texto(diccionario, "roles.accion_nota.fuera_del_plan");
        return {
          id: accion,
          etiqueta: textoDeLaAccion(diccionario, accion),
          nota,
          deshabilitada: piso !== null || !m.enElPlan,
        };
      }),
    }));
  return {
    nombre: texto(diccionario, "caja.campo.nombre"),
    nombreInicial: rol.nombre,
    activo: rol.activo,
    insignia: rol.activo
      ? null
      : { tono: "neutro", texto: texto(diccionario, "roles.estado.archivado") },
    queHace: { rotulo: texto(diccionario, "roles.formulario.que_puede_hacer"), grupos, marcadas },
    guardar: texto(diccionario, "caja.accion.guardar"),
    cancelar: texto(diccionario, "caja.accion.cancelar"),
    archivar: ofertas.editar && rol.activo ? texto(diccionario, "roles.boton.archivar") : null,
    reactivar: ofertas.editar && !rol.activo ? texto(diccionario, "caja.accion.reactivar") : null,
  };
}

/** Lo que entrega el servidor para el selector de la ficha de una persona: los dos roles base y los roles propios activos que se pueden asignar. */
export type RolesAsignablesParaLaPantalla = Readonly<{
  base: readonly ("ADMINISTRADOR" | "OPERADOR")[];
  propios: readonly Readonly<{ rolId: string; nombre: string }>[];
}>;

/** El rol actual de la persona: uno base, o uno propio con su id y su nombre. */
export type RolActualDeLaPersona =
  | Readonly<{ tipo: "BASE"; rol: "ADMINISTRADOR" | "OPERADOR" | "GERENTE" }>
  | Readonly<{ tipo: "PROPIO"; rolId: string; nombre: string }>;

export type EditorDeRolDeUsuarioArmado = Readonly<{
  rotulo: string;
  /** El valor elegido al abrir: `BASE:<rol>` o `PROPIO:<id>` (el rol actual de la persona). */
  valorInicial: string;
  opciones: readonly Readonly<{ valor: string; etiqueta: string; apagada?: boolean }>[];
  guardar: string;
}>;

/**
 * El selector «Rol» de la ficha de una persona: los dos roles base y los roles propios activos, con el rol actual marcado. Si el rol actual es uno propio que ya no se puede asignar (archivado) se muestra igual, como opción
 * apagada con su nombre: así el selector arranca en un valor real y un toque en «Guardar» no reasigna a la persona sin que la elija. El gerente no se asigna (no tiene editor: lo decide la página).
 */
export function armarElEditorDeRolDeUsuario(
  asignables: RolesAsignablesParaLaPantalla,
  actual: RolActualDeLaPersona,
  diccionario: DiccionarioResuelto,
): EditorDeRolDeUsuarioArmado {
  const opciones: { valor: string; etiqueta: string; apagada?: boolean }[] = [
    ...asignables.base.map((r) => ({
      valor: `BASE:${r}`,
      etiqueta: texto(
        diccionario,
        r === "ADMINISTRADOR" ? "rol.administrador.nombre" : "rol.operador.nombre",
      ),
    })),
    ...asignables.propios.map((r) => ({ valor: `PROPIO:${r.rolId}`, etiqueta: r.nombre })),
  ];
  const valorInicial = actual.tipo === "PROPIO" ? `PROPIO:${actual.rolId}` : `BASE:${actual.rol}`;
  if (!opciones.some((o) => o.valor === valorInicial) && actual.tipo === "PROPIO") {
    opciones.push({ valor: valorInicial, etiqueta: actual.nombre, apagada: true });
  }
  return {
    rotulo: texto(diccionario, "usuarios.campo.rol"),
    valorInicial,
    opciones,
    guardar: texto(diccionario, "caja.accion.guardar"),
  };
}
