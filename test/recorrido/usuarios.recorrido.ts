import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { crearMundoDeMarca } from "../integracion/marcas-apoyo";
import { ingresarEn, personaVinculada } from "../integracion/web-apoyo";
import {
  crearAsignacionDeBase,
  crearInvitacionDeBase,
  crearMembresiaDeBase,
  crearPersonaDeBase,
  incluirEmpresa,
  sucursalDe,
} from "../integracion/fixtures-identidad";
import { HOST_DEL_RECORRIDO, armarMundoDelRecorrido, type MundoDelRecorrido } from "./apoyo/mundo";
import { vigilar, violacionesGravesDeAxe, type Vigilante } from "./apoyo/vigilante";

/**
 * «Usuarios» de Cuenta (tramos U1 y U3 parte A) de punta a punta en la app REAL construida, con un navegador real y una base real: el gerente entra desde Cuenta → «Usuarios» y ve a la gente de su empresa
 * con su rol («Gerente», «Administrador», «Empleado»), a la desactivada con su texto y las invitaciones con «Vence el …», «Vencida» o «Pendiente»; abre la ficha de una persona; nunca ve a nadie de otra empresa (la
 * ficha de una ajena dice lo mismo que una inexistente). Después la misma persona pasa a ser empleada: la entrada «Usuarios» desaparece de Cuenta y, abriendo la dirección a mano, el servidor responde con el
 * mensaje genérico, sin filas. Tramo U3 (desactivar): R1 el gerente desactiva a una persona CON confirmación («Cancelar» no hace nada) y la ficha pasa a «Desactivado», con sus sucursales apagadas y su invitación revocada; R2 confirmar en dos pestañas
 * deja una sola desactivación; R4 (parte B) reactivar: la ficha de un desactivado ofrece «Reactivar», que abre el formulario de invitar con su email y su rol fijos, y al enviar queda UNA invitación pendiente y un mail (una activa, una ajena o el gerente dan el genérico); R3 un administrador no ve «Desactivar» en la ficha del gerente ni en la propia (sí en la de otro administrador). Lo que esta prueba ve y las de componentes no: la página en el servidor (el permiso y la lectura de la base), la fila del menú y que los componentes no rompan en el navegador.
 * El tramo U4 suma las sucursales del empleado: tildar y guardar (R1), guardar sin cambios no deja constancia (R2) y dos pestañas dejan la última edición completa (R3).
 */
const base = inject("baseDePruebas");
const CELULAR = { width: 390, height: 844 } as const;
const GENERICO = "Esta acción no está permitida";
const DIA = 86_400_000;

describe.skipIf(base === null)("recorrido de la lista de usuarios", () => {
  let mundo: MundoDelRecorrido;
  let navegador: Browser;
  let contexto: BrowserContext;
  let pagina: Page;
  let vigilante: Vigilante;
  let sofia = "";
  let diego = "";
  let deOtraEmpresa = "";

  const ir = async (ruta: string) => {
    const respuesta = await pagina.goto(`${mundo.url}${ruta}`);
    await pagina.waitForLoadState("networkidle");
    return respuesta;
  };
  const sinViolacionesDeAxe = async () => expect(await violacionesGravesDeAxe(pagina)).toEqual([]);
  const pantallaLimpia = () => expect(vigilante.tomar()).toEqual([]);

  beforeAll(async () => {
    if (base === null) return;
    mundo = await armarMundoDelRecorrido(base);
    const c = mundo.mundo.dueno;
    const tenant = (
      await c.query<{ tenant_id: string }>("select tenant_id from empresa where id = $1", [
        mundo.empresa,
      ])
    ).rows[0]?.tenant_id as string;
    const sumar = async (email: string, rol: "ADMINISTRADOR" | "OPERADOR", activo = true) => {
      const persona = await crearPersonaDeBase(c, email);
      await crearMembresiaDeBase(c, mundo.empresa, persona.id, rol, activo);
      return persona.id;
    };
    diego = await sumar("diego@lacteos.test", "ADMINISTRADOR");
    sofia = await sumar("sofia@lacteos.test", "OPERADOR");
    await sumar("ana@lacteos.test", "OPERADOR", false);
    const ahora = Date.now();
    for (const [email, rol, vence] of [
      ["julia@lacteos.test", "OPERADOR", ahora + 5 * DIA],
      ["pablo@lacteos.test", "ADMINISTRADOR", ahora - 2 * DIA],
    ] as const) {
      const inv = await crearInvitacionDeBase(c, { tenant, email, venceEn: new Date(vence) });
      await incluirEmpresa(c, inv, mundo.empresa, rol);
    }
    // Otra empresa (otro tenant) con su gente y su invitación: nada de esto tiene que verse.
    const otra = await crearMundoDeMarca(c, { marca: mundo.mundo.marcaA });
    const ajena = await crearPersonaDeBase(c, "ajena@otra-empresa.test");
    await crearMembresiaDeBase(c, otra.empresa, ajena.id, "OPERADOR");
    deOtraEmpresa = ajena.id;
    const invAjena = await crearInvitacionDeBase(c, {
      tenant: otra.tenant,
      email: "invitada@otra-empresa.test",
      venceEn: new Date(ahora + 3 * DIA),
    });
    await incluirEmpresa(c, invAjena, otra.empresa, "OPERADOR");

    const ejecutable = process.env["PEDERNAL_NAVEGADOR"];
    navegador = await chromium.launch({
      ...(ejecutable === undefined || ejecutable === "" ? {} : { executablePath: ejecutable }),
      args: ["--no-proxy-server"],
    });
    contexto = await navegador.newContext({ ignoreHTTPSErrors: true, viewport: CELULAR });
    await contexto.addCookies([...mundo.cookies]);
    pagina = await contexto.newPage();
    vigilante = await vigilar(pagina, HOST_DEL_RECORRIDO);
  });
  afterAll(async () => {
    await navegador?.close();
    await mundo?.cerrar();
  });

  it("el gerente entra desde Cuenta → «Usuarios» y ve a su gente y sus invitaciones, sin nada de otra empresa", async () => {
    await ir("/cuenta");
    await pagina.getByRole("link", { name: "Usuarios" }).click();
    await pagina.waitForURL(/\/cuenta\/usuarios$/);
    await pagina.waitForLoadState("networkidle");
    await pagina.getByRole("heading", { name: "Invitaciones" }).waitFor();

    const fila = (nombre: string) => pagina.getByRole("link", { name: nombre, exact: true });
    expect(await fila("diego@lacteos.test Administrador").count()).toBe(1);
    expect(await fila("sofia@lacteos.test Empleado").count()).toBe(1);
    expect(await fila("ana@lacteos.test Empleado Desactivado").count()).toBe(1);
    expect(await pagina.getByText("Gerente", { exact: false }).count()).toBeGreaterThan(0);
    await pagina.getByText("Empleado · Vence el", { exact: false }).first().waitFor();
    expect(await pagina.getByText("Vencida").count()).toBe(1);
    expect(await pagina.getByText("Pendiente").count()).toBe(1);
    expect(await pagina.getByText("ajena@otra-empresa.test").count()).toBe(0);
    expect(await pagina.getByText("invitada@otra-empresa.test").count()).toBe(0);
    expect(
      await pagina.getByRole("button", { name: /Invitar|Desactivar|Reactivar|Guardar/ }).count(),
    ).toBe(0);
    await sinViolacionesDeAxe();
    pantallaLimpia();
  });

  it("la ficha de una persona de la empresa muestra su rol y su estado; la de una de otra empresa dice lo mismo que una que no existe", async () => {
    await ir(`/cuenta/usuarios/${sofia}`);
    await pagina.getByRole("heading", { name: "sofia@lacteos.test" }).waitFor();
    await pagina.getByText("Empleado").first().waitFor();
    await pagina.getByText("Activo").first().waitFor();
    // Un empleado activo trae el bloque «Sucursales» con su «Guardar» (tramo U4) y, para el gerente, el botón «Desactivar» (tramo U3); sus pruebas completas son las de los bloques siguientes.
    await pagina.getByRole("group", { name: "Sucursales" }).waitFor();
    expect(await pagina.getByRole("button", { name: "Desactivar" }).count()).toBe(1);
    await sinViolacionesDeAxe();

    // El administrador y el gerente trabajan en todas las sucursales: su ficha no dice nada de sucursales. Al administrador el gerente sí lo puede desactivar: sus dos botones son «Desactivar» y el «Guardar» del rol (H4b, T6).
    await ir(`/cuenta/usuarios/${diego}`);
    await pagina.getByRole("heading", { name: "diego@lacteos.test" }).waitFor();
    await pagina.getByText("Administrador").first().waitFor();
    expect(await pagina.getByRole("button").count()).toBe(2);
    expect(await pagina.getByRole("button", { name: "Desactivar" }).count()).toBe(1);
    expect(await pagina.getByRole("button", { name: "Guardar" }).count()).toBe(1);
    expect(await pagina.getByText("Sucursales").count()).toBe(0);

    await ir(`/cuenta/usuarios/${deOtraEmpresa}`);
    await pagina.getByText(GENERICO).first().waitFor();
    expect(await pagina.getByText("ajena@otra-empresa.test").count()).toBe(0);
    await ir("/cuenta/usuarios/0b0b0b0b-1111-4222-8333-4444444444ee");
    await pagina.getByText(GENERICO).first().waitFor();
    await ir("/cuenta/usuarios/no-es-un-id");
    await pagina.getByText(GENERICO).first().waitFor();
    pantallaLimpia();
  });

  it("U4: tildar sucursales en la ficha del empleado y guardar; guardar lo mismo no deja constancia nueva; dos pestañas dejan la última, completa", async () => {
    const c = mundo.mundo.dueno;
    const norte = (
      await c.query<{ id: string }>(
        "insert into sucursal (empresa_id, nombre) values ($1, 'Norte') returning id",
        [mundo.empresa],
      )
    ).rows[0]?.id as string;
    const sur = (
      await c.query<{ id: string }>(
        "insert into sucursal (empresa_id, nombre) values ($1, 'Sur') returning id",
        [mundo.empresa],
      )
    ).rows[0]?.id as string;
    await c.query(
      "insert into sucursal (empresa_id, nombre, activa) values ($1, 'Cerrada', false)",
      [mundo.empresa],
    );
    const asignadas = async () =>
      (
        await c.query<{ sucursal_id: string }>(
          "select sucursal_id from asignacion_sucursal where empresa_id = $1 and persona_id = $2 and activa order by sucursal_id",
          [mundo.empresa, sofia],
        )
      ).rows.map((f) => f.sucursal_id);
    const auditorias = async () =>
      Number(
        (
          await c.query<{ n: string }>(
            "select count(*) as n from auditoria_empresa where empresa_id = $1 and accion = 'ASIGNACIONES_CAMBIADAS' and entidad_id = $2",
            [mundo.empresa, sofia],
          )
        ).rows[0]?.n,
      );
    const guardar = async (p: Page) => {
      // La ficha tiene dos formularios con «Guardar» (el del rol y el de sucursales): este es el de «Sucursales».
      await p
        .locator("form")
        .filter({ has: p.getByRole("group", { name: "Sucursales" }) })
        .getByRole("button", { name: "Guardar" })
        .click();
      await p.waitForLoadState("networkidle");
    };

    // R1: tildar «Norte» y «Sur», guardar, recargar y verlas tildadas; la desactivada no se ofrece.
    await ir(`/cuenta/usuarios/${sofia}`);
    const grupo = pagina.getByRole("group", { name: "Sucursales" });
    await grupo.waitFor();
    expect(await grupo.getByRole("checkbox").count()).toBe(3);
    expect(await pagina.getByText("Cerrada").count()).toBe(0);
    await grupo.getByRole("checkbox", { name: "Norte" }).check();
    await grupo.getByRole("checkbox", { name: "Sur" }).check();
    await guardar(pagina);
    await expect.poll(asignadas).toEqual([norte, sur].sort());
    await ir(`/cuenta/usuarios/${sofia}`);
    expect(await grupo.getByRole("checkbox", { name: "Norte" }).isChecked()).toBe(true);
    expect(await grupo.getByRole("checkbox", { name: "Sur" }).isChecked()).toBe(true);
    expect(await auditorias()).toBe(1);

    // R2: guardar sin cambios no deja constancia nueva.
    await guardar(pagina);
    await guardar(pagina);
    expect(await auditorias()).toBe(1);
    expect(await asignadas()).toEqual([norte, sur].sort());

    // R3: dos pestañas con la ficha vieja; la que guarda última deja su conjunto, completo y sin mezclar.
    const otraPestana = await contexto.newPage();
    try {
      await otraPestana.goto(`${mundo.url}/cuenta/usuarios/${sofia}`);
      await otraPestana.waitForLoadState("networkidle");
      await ir(`/cuenta/usuarios/${sofia}`);
      await grupo.getByRole("checkbox", { name: "Norte" }).uncheck();
      await guardar(pagina); // queda solo «Sur»
      await expect.poll(asignadas).toEqual([sur]);
      const suya = otraPestana.getByRole("group", { name: "Sucursales" });
      await suya.getByRole("checkbox", { name: "Sur" }).uncheck(); // la vista vieja tenía Norte y Sur: queda solo «Norte»
      await guardar(otraPestana); // gana la última (sin aviso: pregunta 10 del plan), con su conjunto completo
      await expect.poll(asignadas).toEqual([norte]);
      await ir(`/cuenta/usuarios/${sofia}`);
      expect(await grupo.getByRole("checkbox", { checked: true }).count()).toBe(1);
      expect(await grupo.getByRole("checkbox", { name: "Norte" }).isChecked()).toBe(true);
    } finally {
      await otraPestana.close();
    }
    await sinViolacionesDeAxe();
    pantallaLimpia();
  });

  it("un empleado no tiene la entrada «Usuarios» y, abriendo la dirección a mano, recibe el genérico y ninguna fila", async () => {
    // Otra persona que entra de verdad (misma app y misma base) y es EMPLEADA de la empresa.
    const otra = await ingresarEn(mundo.mundo, HOST_DEL_RECORRIDO);
    const empleada = await personaVinculada(mundo.mundo, otra.sesion);
    await crearMembresiaDeBase(mundo.mundo.dueno, mundo.empresa, empleada, "OPERADOR");
    const suContexto = await navegador.newContext({ ignoreHTTPSErrors: true, viewport: CELULAR });
    await suContexto.addCookies(
      otra.navegador.cookiesDe(HOST_DEL_RECORRIDO).map((c) => ({
        name: c.nombre,
        value: c.valor,
        domain: HOST_DEL_RECORRIDO,
        path: "/" as const,
        httpOnly: true as const,
        secure: true as const,
      })),
    );
    pagina = await suContexto.newPage();
    vigilante = await vigilar(pagina, HOST_DEL_RECORRIDO);

    await ir("/cuenta");
    await pagina.getByRole("button", { name: "Cerrar sesión" }).waitFor();
    expect(await pagina.getByRole("link", { name: "Usuarios" }).count()).toBe(0);

    await ir("/cuenta/usuarios");
    await pagina.getByText(GENERICO).first().waitFor();
    expect(await pagina.getByText("@lacteos.test", { exact: false }).count()).toBe(0);
    expect(await pagina.getByRole("heading", { name: "Invitaciones" }).count()).toBe(0);

    await ir(`/cuenta/usuarios/${sofia}`);
    await pagina.getByText(GENERICO).first().waitFor();
    expect(await pagina.getByText("sofia@lacteos.test").count()).toBe(0);
    await sinViolacionesDeAxe();
    pantallaLimpia();
    await suContexto.close();
  });
  /** Un contexto de navegador del gerente (la sesión del mundo) con su página. */
  async function comoElGerente() {
    const ctx = await navegador.newContext({ ignoreHTTPSErrors: true, viewport: CELULAR });
    await ctx.addCookies([...mundo.cookies]);
    const pag = await ctx.newPage();
    return { ctx, pag, vig: await vigilar(pag, HOST_DEL_RECORRIDO) };
  }
  const aDeLaBase = async (sql: string, args: unknown[] = []) =>
    (await mundo.mundo.dueno.query(sql, args)).rows as Record<string, unknown>[];

  it("R1: el gerente desactiva a una persona CON confirmación: «Cancelar» no hace nada y al confirmar queda «Desactivado»", async () => {
    const c = mundo.mundo.dueno;
    const marta = await crearPersonaDeBase(c, "marta@lacteos.test");
    await crearMembresiaDeBase(c, mundo.empresa, marta.id, "OPERADOR");
    await crearAsignacionDeBase(c, mundo.empresa, marta.id, await sucursalDe(c, mundo.empresa));
    const tenant = (
      await aDeLaBase("select tenant_id from empresa where id = $1", [mundo.empresa])
    )[0]?.["tenant_id"] as string;
    const inv = await crearInvitacionDeBase(c, {
      tenant,
      email: "marta@lacteos.test",
      venceEn: new Date(Date.now() + 5 * DIA),
    });
    await incluirEmpresa(c, inv, mundo.empresa, "OPERADOR");

    const { ctx, pag, vig } = await comoElGerente();
    const abrir = async () => {
      await pag.goto(`${mundo.url}/cuenta/usuarios/${marta.id}`);
      await pag.waitForLoadState("networkidle");
    };
    await abrir();
    await pag.getByRole("heading", { name: "marta@lacteos.test" }).waitFor();

    // Pide confirmar; «Cancelar» cierra y no cambia nada.
    await pag.getByRole("button", { name: "Desactivar" }).click();
    const dialogo = pag.getByRole("dialog");
    await dialogo.getByRole("heading", { name: "¿Desactivar a marta@lacteos.test?" }).waitFor();
    await dialogo.getByText("Se corta su acceso ahora.").waitFor();
    expect(await violacionesGravesDeAxe(pag)).toEqual([]);
    await dialogo.getByRole("button", { name: "Cancelar" }).click();
    await pag.getByRole("dialog").waitFor({ state: "hidden" });
    expect(await pag.getByText("Activo").count()).toBe(1);
    expect(
      (await aDeLaBase("select activo from membresia where persona_id = $1", [marta.id]))[0],
    ).toEqual({ activo: true });

    // Confirmar: queda «Desactivado», sin el botón, y todo lo que debía apagarse está apagado (sin borrar nada).
    await pag.getByRole("button", { name: "Desactivar" }).click();
    await pag.getByRole("dialog").getByRole("button", { name: "Desactivar" }).click();
    await pag.getByText("Desactivado").first().waitFor();
    await pag.getByRole("button", { name: "Desactivar" }).waitFor({ state: "detached" });
    // El gerente puede reasignar el rol de una persona desactivada (sigue desactivada): queda solo el «Guardar» del rol.
    expect(await pag.getByRole("button").count()).toBe(1);
    expect(await pag.getByRole("button", { name: "Guardar" }).count()).toBe(1);
    expect(
      (await aDeLaBase("select activo from membresia where persona_id = $1", [marta.id]))[0],
    ).toEqual({ activo: false });
    expect(
      await aDeLaBase("select activa from asignacion_sucursal where persona_id = $1", [marta.id]),
    ).toEqual([{ activa: false }]);
    expect((await aDeLaBase("select estado from invitacion where id = $1", [inv.id]))[0]).toEqual({
      estado: "REVOCADA",
    });
    expect(await aDeLaBase("select id from persona where id = $1", [marta.id])).toHaveLength(1);
    expect(await violacionesGravesDeAxe(pag)).toEqual([]);

    // La lista la muestra «Desactivado» y la invitación ya no figura.
    await pag.goto(`${mundo.url}/cuenta/usuarios`);
    await pag.waitForLoadState("networkidle");
    await pag
      .getByRole("link", { name: "marta@lacteos.test Empleado Desactivado", exact: true })
      .waitFor();
    expect(await pag.getByText("marta@lacteos.test").count()).toBe(1);
    expect(vig.tomar()).toEqual([]);
    await ctx.close();
  });

  it("R2: confirmar en dos pestañas desactiva una sola vez, sin error, y las dos terminan en «Desactivado»", async () => {
    const c = mundo.mundo.dueno;
    const luis = await crearPersonaDeBase(c, "luis@lacteos.test");
    await crearMembresiaDeBase(c, mundo.empresa, luis.id, "OPERADOR");
    const uno = await comoElGerente();
    const dos = await comoElGerente();
    for (const { pag } of [uno, dos]) {
      await pag.goto(`${mundo.url}/cuenta/usuarios/${luis.id}`);
      await pag.waitForLoadState("networkidle");
      await pag.getByRole("button", { name: "Desactivar" }).click();
      await pag.getByRole("dialog").getByText("Se corta su acceso ahora.").waitFor();
    }
    for (const { pag } of [uno, dos]) {
      await pag.getByRole("dialog").getByRole("button", { name: "Desactivar" }).click();
      await pag.getByText("Desactivado").first().waitFor();
      expect(await pag.getByText("Esta acción no está permitida").count()).toBe(0);
    }
    expect(
      await aDeLaBase(
        "select id from auditoria_empresa where empresa_id = $1 and accion = 'MEMBRESIA_APAGADA' and entidad_id = $2",
        [mundo.empresa, luis.id],
      ),
    ).toHaveLength(1);
    await uno.ctx.close();
    await dos.ctx.close();
  });

  it("R3: un administrador no ve «Desactivar» en la ficha del gerente ni en la suya, pero sí en la de otro administrador", async () => {
    const c = mundo.mundo.dueno;
    const gerente = (
      await aDeLaBase(
        "select persona_id from membresia where empresa_id = $1 and rol = 'GERENTE'",
        [mundo.empresa],
      )
    )[0]?.["persona_id"] as string;
    const diego = (
      await aDeLaBase("select id from persona where email = 'diego@lacteos.test'")
    )[0]?.["id"] as string;
    // Un administrador que entra de verdad.
    const otra = await ingresarEn(mundo.mundo, HOST_DEL_RECORRIDO);
    const yo = await personaVinculada(mundo.mundo, otra.sesion);
    await crearMembresiaDeBase(c, mundo.empresa, yo, "ADMINISTRADOR");
    const ctx = await navegador.newContext({ ignoreHTTPSErrors: true, viewport: CELULAR });
    await ctx.addCookies(
      otra.navegador.cookiesDe(HOST_DEL_RECORRIDO).map((k) => ({
        name: k.nombre,
        value: k.valor,
        domain: HOST_DEL_RECORRIDO,
        path: "/" as const,
        httpOnly: true as const,
        secure: true as const,
      })),
    );
    const pag = await ctx.newPage();
    const vig = await vigilar(pag, HOST_DEL_RECORRIDO);
    const ver = async (id: string) => {
      await pag.goto(`${mundo.url}/cuenta/usuarios/${id}`);
      await pag.waitForLoadState("networkidle");
      await pag.getByText("Rol").first().waitFor();
    };

    await ver(gerente);
    expect(await pag.getByText("Gerente").count()).toBeGreaterThan(0);
    expect(await pag.getByRole("button", { name: "Desactivar" }).count()).toBe(0);
    await ver(yo);
    expect(await pag.getByText("Administrador").count()).toBeGreaterThan(0);
    expect(await pag.getByRole("button", { name: "Desactivar" }).count()).toBe(0);
    await ver(diego);
    expect(await pag.getByRole("button", { name: "Desactivar" }).count()).toBe(1);
    expect(vig.tomar()).toEqual([]);
    await ctx.close();
  });
  it("R4 reactivar: la ficha del desactivado ofrece «Reactivar», abre el formulario con su email y su rol fijos, y al enviar queda UNA invitación pendiente con el mismo rol y un solo mail", async () => {
    const c = mundo.mundo.dueno;
    const rita = await crearPersonaDeBase(c, "rita@lacteos.test");
    await crearMembresiaDeBase(c, mundo.empresa, rita.id, "OPERADOR", false);
    const { ctx, pag, vig } = await comoElGerente();

    await pag.goto(`${mundo.url}/cuenta/usuarios/${rita.id}`);
    await pag.waitForLoadState("networkidle");
    await pag.getByRole("heading", { name: "rita@lacteos.test" }).waitFor();
    await pag.getByText("Desactivado").first().waitFor();
    expect(await pag.getByRole("button", { name: "Desactivar" }).count()).toBe(0);
    await pag.getByRole("link", { name: "Reactivar" }).click();
    await pag.waitForURL(/\/cuenta\/usuarios\/invitar\?reactivar=/);
    await pag.waitForLoadState("networkidle");

    // El mismo formulario de invitar, con el email y el rol FIJOS de la persona; las sucursales se eligen.
    await pag.getByRole("heading", { name: "Reactivar" }).waitFor();
    expect(await pag.getByLabel("Email").inputValue()).toBe("rita@lacteos.test");
    expect(await pag.getByLabel("Email").isDisabled()).toBe(true);
    expect(await pag.getByLabel("Rol").inputValue()).toBe("OPERADOR");
    expect(await pag.getByLabel("Rol").isDisabled()).toBe(true);
    await pag.getByRole("group", { name: "Sucursales" }).waitFor();
    expect(await violacionesGravesDeAxe(pag)).toEqual([]);

    await pag.getByRole("button", { name: "Enviar invitación" }).click();
    await pag.waitForURL(/\/cuenta\/usuarios$/);
    await pag.waitForLoadState("networkidle");
    await pag.getByRole("heading", { name: "Invitaciones" }).waitFor();
    await pag.getByText("rita@lacteos.test").first().waitFor();
    const invitaciones = await aDeLaBase(
      `select i.id, i.estado, ie.rol from invitacion i join invitacion_empresa ie on ie.invitacion_id = i.id
        where ie.empresa_id = $1 and i.email = 'rita@lacteos.test'`,
      [mundo.empresa],
    );
    expect(invitaciones.map((i) => [i["estado"], i["rol"]])).toEqual([["PENDIENTE", "OPERADOR"]]);
    expect(
      await aDeLaBase(
        "select id from trabajo where empresa_id = $1 and tipo = 'enviar_invitacion' and clave_idempotencia = $2",
        [mundo.empresa, `invitacion:${String(invitaciones[0]?.["id"])}:envio`],
      ),
    ).toHaveLength(1);
    // La persona sigue desactivada hasta que acepte.
    expect(
      (await aDeLaBase("select activo from membresia where persona_id = $1", [rita.id]))[0],
    ).toEqual({ activo: false });

    // Una persona activa, una ajena y una que no existe no se reactivan: el genérico y sin formulario.
    for (const id of [
      sofia,
      deOtraEmpresa,
      "0b0b0b0b-1111-4222-8333-4444444444ee",
      "no-es-un-id",
    ]) {
      await pag.goto(`${mundo.url}/cuenta/usuarios/invitar?reactivar=${id}`);
      await pag.waitForLoadState("networkidle");
      await pag.getByText(GENERICO).first().waitFor();
      expect(await pag.getByRole("button", { name: "Enviar invitación" }).count()).toBe(0);
    }
    expect(vig.tomar()).toEqual([]);
    await ctx.close();
  });
});
