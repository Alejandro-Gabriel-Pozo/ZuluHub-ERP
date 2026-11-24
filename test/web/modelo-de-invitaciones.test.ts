import { describe, expect, it } from "vitest";
import {
  armarElFormularioDeInvitacion,
  armarLaFichaDeInvitacion,
  ROL_CON_SUCURSALES,
  ROL_INICIAL_DE_LA_INVITACION,
} from "../../apps/web/ui/plantillas/usuarios/modelo-de-invitaciones";
import { armarLaListaDeUsuarios } from "../../apps/web/ui/plantillas/usuarios/modelo-de-usuarios";

const CENTRO = { id: "s-1", nombre: "Centro" };
const NORTE = { id: "s-2", nombre: "Norte" };

describe("armarElFormularioDeInvitacion", () => {
  it("ofrece Administrador y Empleado, nunca Gerente, y nace en Empleado", () => {
    const f = armarElFormularioDeInvitacion([CENTRO]);
    expect(f.roles).toEqual([
      { valor: "ADMINISTRADOR", etiqueta: "Administrador" },
      { valor: "OPERADOR", etiqueta: "Empleado" },
    ]);
    expect(ROL_INICIAL_DE_LA_INVITACION).toBe("OPERADOR");
    expect(ROL_CON_SUCURSALES).toBe("OPERADOR");
  });

  it("los textos salen del catálogo (los aprobados el 23/11/2026) y reusan los que ya existían", () => {
    const f = armarElFormularioDeInvitacion([CENTRO, NORTE]);
    expect(f.textos).toEqual({
      email: "Email",
      rol: "Rol",
      sucursales: "Sucursales",
      enviar: "Enviar invitación",
      cancelar: "Cancelar",
      yaHabia: "Ya había una invitación pendiente para ese email",
      emailDeGoogle: "El email tiene que ser de una cuenta de Google",
    });
    expect(f.sucursales).toEqual([CENTRO, NORTE]);
  });
});

describe("armarLaFichaDeInvitacion", () => {
  const invitacion = {
    invitacionId: "i-1",
    email: "julia@x.test",
    rol: "OPERADOR",
    venceEn: "2026-11-30T02:00:00.000Z",
    vencida: false,
    sucursales: ["s-2", "s-desactivada"],
  } as const;

  it("rol, sucursales por nombre (la desactivada no se nombra), estado con texto y vencimiento en hora de Argentina", () => {
    const f = armarLaFichaDeInvitacion(invitacion, [CENTRO, NORTE]);
    expect(f.email).toBe("julia@x.test");
    expect(f.renglones).toEqual([
      { rotulo: "Rol", valor: "Empleado", insignia: null },
      { rotulo: "Sucursales", valor: "Norte", insignia: null },
      { rotulo: "Estado", valor: null, insignia: { tono: "neutro", texto: "Pendiente" } },
    ]);
    // 02:00 UTC del 30/11 todavía es el 29/11 en Argentina.
    expect(f.vence).toBe("Vence el 29/11/2026");
    expect([f.reenviar, f.revocar]).toEqual(["Reenviar", "Revocar"]);
    expect(f.rutaDeLaLista).toBe("/cuenta/usuarios");
  });

  it("vencida se dice con texto y tono de peligro; sin sucursales, un guion", () => {
    const f = armarLaFichaDeInvitacion(
      { ...invitacion, vencida: true, rol: "ADMINISTRADOR", sucursales: [] },
      [CENTRO],
    );
    expect(f.renglones[0]?.valor).toBe("Administrador");
    expect(f.renglones[1]?.valor).toBe("—");
    expect(f.renglones[2]?.insignia).toEqual({ tono: "peligro", texto: "Vencida" });
  });
});

describe("la lista con «Invitar» y las filas de invitación enlazadas", () => {
  const lista = {
    usuarios: [],
    invitaciones: [
      {
        invitacionId: "i-1",
        email: "julia@x.test",
        rol: "OPERADOR",
        venceEn: "2026-11-29T10:00:00.000Z",
        vencida: false,
      },
    ],
  } as const;

  it("«Invitar» solo con permiso: sin él, no se dibuja (todo nace cerrado)", () => {
    expect(armarLaListaDeUsuarios(lista).invitar).toBeNull();
    expect(armarLaListaDeUsuarios(lista, {}, false).invitar).toBeNull();
    expect(armarLaListaDeUsuarios(lista, {}, true).invitar).toEqual({
      texto: "Invitar",
      href: "/cuenta/usuarios/invitar",
    });
  });

  it("cada invitación lleva a su ficha", () => {
    expect(armarLaListaDeUsuarios(lista).invitaciones?.filas[0]?.href).toBe(
      "/cuenta/usuarios/invitaciones/i-1",
    );
  });
});
