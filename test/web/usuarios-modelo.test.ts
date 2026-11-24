import { describe, expect, it } from "vitest";
import type { ListaDeUsuariosParaLaPantalla } from "../../src/composicion/usuarios-web";
import {
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
