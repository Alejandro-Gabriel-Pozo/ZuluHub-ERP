import { describe, expect, it } from "vitest";
import type { ListaDeUsuariosParaLaPantalla } from "../../src/composicion/usuarios-web";
import {
  armarElEditorDeSucursales,
  armarLaFichaDeUsuario,
  armarLaListaDeUsuarios,
} from "../../apps/web/ui/plantillas/usuarios/modelo-de-usuarios";

/**
 * El modelo de «Usuarios»: el orden del servidor, el rol traducido (el empleado dice «Empleado»), el vencimiento dd/mm/aaaa en hora de Argentina, las insignias con texto y el bloque de
 * invitaciones que no existe si no hay ninguna. Previene: un vencimiento mostrado un día corrido (UTC en vez de Argentina) y un estado que se diga solo con color.
 */
const U = (
  n: number,
  email: string,
  rol: "GERENTE" | "ADMINISTRADOR" | "OPERADOR",
  activo = true,
) => ({
  personaId: `0b0b0b0b-1111-4222-8333-44444444444${n}`,
  email,
  rol,
  activo,
});
const I = (
  id: string,
  venceEn: string,
  vencida: boolean,
  rol: "ADMINISTRADOR" | "OPERADOR" = "OPERADOR",
) => ({
  invitacionId: id,
  email: `${id}@x.test`,
  rol,
  venceEn,
  vencida,
});

describe("armarLaListaDeUsuarios", () => {
  const datos: ListaDeUsuariosParaLaPantalla = {
    usuarios: [
      U(1, "ana@x.test", "OPERADOR", false),
      U(2, "diego@x.test", "ADMINISTRADOR"),
      U(3, "laura@x.test", "GERENTE"),
      U(4, "sofia@x.test", "OPERADOR"),
    ],
    invitaciones: [],
  };

  it("mantiene el orden del servidor, con el rol traducido («Empleado») y la ficha como destino", () => {
    const { usuarios } = armarLaListaDeUsuarios(datos);
    expect(usuarios.map((u) => [u.email, u.rol])).toEqual([
      ["ana@x.test", "Empleado"],
      ["diego@x.test", "Administrador"],
      ["laura@x.test", "Gerente"],
      ["sofia@x.test", "Empleado"],
    ]);
    expect(usuarios.map((u) => u.href)).toEqual(
      datos.usuarios.map((u) => `/cuenta/usuarios/${u.personaId}`),
    );
  });

  it("solo la persona desactivada lleva insignia, y dice «Desactivado» con texto", () => {
    const { usuarios } = armarLaListaDeUsuarios(datos);
    expect(usuarios.map((u) => u.insignia)).toEqual([
      { tono: "aviso", texto: "Desactivado" },
      null,
      null,
      null,
    ]);
  });

  it("sin invitaciones no hay bloque (ni encabezado)", () => {
    expect(armarLaListaDeUsuarios(datos).invitaciones).toBeNull();
  });

  it("el vencimiento sale dd/mm/aaaa en la hora de Argentina: 02:59:59 UTC es todavía el día anterior; 03:00:00 UTC ya es el siguiente", () => {
    const r = armarLaListaDeUsuarios({
      usuarios: [],
      invitaciones: [
        I("antes", "2026-11-29T02:59:59.000Z", false),
        I("despues", "2026-11-29T03:00:00.000Z", false),
        I("medianoche", "2026-12-01T00:00:00.000Z", false),
      ],
    });
    expect(r.invitaciones?.filas.map((f) => f.vence)).toEqual([
      "Vence el 28/11/2026",
      "Vence el 29/11/2026",
      "Vence el 30/11/2026",
    ]);
  });

  it("la invitación vencida dice «Vencida» y la vigente «Pendiente», las dos con texto; el rol de la invitación, traducido", () => {
    const r = armarLaListaDeUsuarios({
      usuarios: [],
      invitaciones: [
        I("i1", "2026-11-29T10:00:00.000Z", false, "OPERADOR"),
        I("i2", "2026-11-21T10:00:00.000Z", true, "ADMINISTRADOR"),
      ],
    });
    expect(r.invitaciones?.encabezado).toBe("Invitaciones");
    expect(r.invitaciones?.filas.map((f) => [f.email, f.rol, f.insignia])).toEqual([
      ["i1@x.test", "Empleado", { tono: "neutro", texto: "Pendiente" }],
      ["i2@x.test", "Administrador", { tono: "peligro", texto: "Vencida" }],
    ]);
  });

  it("un vencimiento que no es un instante lanza (falla cerrada), no muestra una fecha a medias", () => {
    expect(() =>
      armarLaListaDeUsuarios({ usuarios: [], invitaciones: [I("i1", "no-es-una-fecha", false)] }),
    ).toThrow(RangeError);
  });
});

describe("armarLaFichaDeUsuario", () => {
  it("el email es el título y debajo van el rol y el estado, este último con texto", () => {
    expect(armarLaFichaDeUsuario(U(3, "sofia@x.test", "OPERADOR"))).toEqual({
      email: "sofia@x.test",
      renglones: [
        { rotulo: "Rol", valor: "Empleado", insignia: null },
        { rotulo: "Estado", valor: null, insignia: { tono: "exito", texto: "Activo" } },
      ],
      desactivar: null,
    });
  });

  it("la persona desactivada figura «Desactivado»", () => {
    expect(armarLaFichaDeUsuario(U(5, "ana@x.test", "OPERADOR", false)).renglones[1]).toEqual({
      rotulo: "Estado",
      valor: null,
      insignia: { tono: "aviso", texto: "Desactivado" },
    });
  });
});

/**
 * Quién ve «Desactivar» en la ficha: solo una persona ACTIVA que NO es el gerente ni quien está mirando, y solo si quien mira tiene el permiso (todo nace cerrado: sin saber quién mira o sin permiso, no se
 * ofrece). Es una ayuda para no ofrecer lo que nunca va a funcionar: el servidor lo impone igual (`ES_EL_GERENTE`, `ES_UNO_MISMO`, el guard). Previene: ofrecer desactivar al gerente o a uno mismo.
 */
describe("armarLaFichaDeUsuario: el botón «Desactivar»", () => {
  const YO = U(9, "yo@x.test", "ADMINISTRADOR");
  const MIRA = { personaId: YO.personaId, puedeDesactivar: true };
  const ofrece = (u: ReturnType<typeof U>, quien: Parameters<typeof armarLaFichaDeUsuario>[2]) =>
    armarLaFichaDeUsuario(u, {}, quien).desactivar !== null;

  it.each([
    ["un empleado activo", U(1, "ana@x.test", "OPERADOR"), true],
    ["otro administrador activo", U(2, "diego@x.test", "ADMINISTRADOR"), true],
    ["el gerente", U(3, "laura@x.test", "GERENTE"), false],
    ["un empleado desactivado", U(4, "sofia@x.test", "OPERADOR", false), false],
    ["un administrador desactivado", U(5, "pablo@x.test", "ADMINISTRADOR", false), false],
    ["la propia persona (administrador)", YO, false],
  ])("quien mira es administrador con permiso: %s → %s", (_, persona, esperado) => {
    expect(ofrece(persona, MIRA)).toBe(esperado);
  });

  it("la propia persona no lo ve aunque sea la única fila y esté activa; el gerente mirándose tampoco", () => {
    const gerente = U(8, "gerente@x.test", "GERENTE");
    expect(ofrece(gerente, { personaId: gerente.personaId, puedeDesactivar: true })).toBe(false);
  });

  it("sin permiso, sin saber quién mira o sin pedir nada, no se ofrece a nadie", () => {
    const empleado = U(1, "ana@x.test", "OPERADOR");
    expect(ofrece(empleado, { personaId: YO.personaId, puedeDesactivar: false })).toBe(false);
    expect(ofrece(empleado, { personaId: null, puedeDesactivar: true })).toBe(false);
    expect(ofrece(empleado, null)).toBe(false);
    expect(armarLaFichaDeUsuario(empleado).desactivar).toBeNull();
  });

  it("los textos del cuadro salen del catálogo, con el email en el título", () => {
    const { desactivar } = armarLaFichaDeUsuario(U(1, "ana@x.test", "OPERADOR"), {}, MIRA);
    expect(desactivar).toEqual({
      boton: "Desactivar",
      titulo: "¿Desactivar a ana@x.test?",
      detalle: "Se corta su acceso ahora.",
      confirmar: "Desactivar",
      cancelar: "Cancelar",
      cerrar: "Cerrar",
      enviando: "Enviando…",
    });
  });
});

describe("armarElEditorDeSucursales", () => {
  it("dice «Sucursales» y «Guardar» con textos del catálogo y conserva el orden y las tildes del servidor", () => {
    const opciones = [
      { id: "s-1", nombre: "Centro", marcada: true },
      { id: "s-2", nombre: "Norte", marcada: false },
    ];
    expect(armarElEditorDeSucursales(opciones)).toEqual({
      rotulo: "Sucursales",
      guardar: "Guardar",
      opciones,
    });
  });
});
