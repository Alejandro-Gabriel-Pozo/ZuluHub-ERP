import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  Navegador,
  levantarProveedorLocal,
  perfilAlAzar,
  type ProveedorLocal,
} from "./autenticacion-ingreso-apoyo";
import {
  HOST_DE_LA_CONSOLA as HOST,
  altaDeAdmin,
  armarPlataformaDePrueba,
  codigoDeLaAplicacion,
  decodificarBase32,
  otroNavegadorConLaSesion,
  type PlataformaDePrueba,
} from "./autenticacion-plataforma-apoyo";
import { crearBaseAparte } from "./entorno";

/**
 * Ningún valor de secreto aparece donde no debe (h5-p8 §4 y §2.4 ter): ni en respuestas, ni en el registro del servidor,
 * ni en la auditoría, ni en la base en claro. La prueba hace un recorrido completo con VALORES CENTINELA (el secreto de la
 * librería, el secreto de Google, el secreto TOTP, la dirección `otpauth`, los códigos de recuperación, los tokens de
 * sesión y los de Google) y los busca en todas partes. El alta del segundo factor y los códigos regenerados SON la
 * excepción: llevan el secreto y los códigos, una sola vez, a quien los pidió.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

type Alta = Readonly<{ qrSvg: string; secreto: string; codigosDeRecuperacion: string[] }>;
type Vista = { ruta: string; estado: number; texto: string; cabeceras: string; esAlta: boolean };

describe.skipIf(base === null)("consola de plataforma: ningún secreto fuera de su lugar", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;
  let proveedor: ProveedorLocal;
  let p: PlataformaDePrueba;

  beforeAll(async () => {
    if (base === null) return;
    vi.stubEnv("NODE_ENV", "production");
    proveedor = await levantarProveedorLocal();
    propia = await crearBaseAparte(base);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
    p = armarPlataformaDePrueba(propia.base, proveedor);
  });
  afterAll(async () => {
    await p.cerrar();
    await dueno.end();
    await propia.destruir();
    await proveedor.cerrar();
    vi.unstubAllEnvs();
  });

  it("recorrido completo (ingreso, alta, verificaciones buenas y malas, bloqueo, recuperación, regenerar, cierre) sin filtrar ningún centinela", async () => {
    const vistas: Vista[] = [];
    const registrar = (
      ruta: string,
      r: { estado: number; texto: string; cabeceras: Headers },
      esAlta = false,
    ) => {
      vistas.push({
        ruta,
        estado: r.estado,
        texto: r.texto,
        cabeceras: [...r.cabeceras.entries()].map(([k, v]) => `${k}: ${v}`).join("\n"),
        esAlta,
      });
    };
    const pedir = async (
      n: Navegador,
      ruta: string,
      metodo: "GET" | "POST",
      cuerpo?: unknown,
      esAlta = false,
    ) => {
      const r = await n.pedir(
        p.autenticacion,
        HOST,
        metodo,
        ruta,
        cuerpo === undefined ? {} : { cuerpo },
      );
      registrar(`${metodo} ${ruta}`, r, esAlta);
      return r;
    };

    const admin = await altaDeAdmin(dueno);
    // 1. Ingreso con Google.
    const n = new Navegador();
    const inicio = await pedir(n, "/api/auth/sign-in/social", "POST", {
      provider: "google",
      callbackURL: "/",
    });
    const retorno = new URL(proveedor.autorizar((inicio.json() as { url: string }).url, admin));
    await pedir(n, `${retorno.pathname}${retorno.search}`, "GET");
    // 2. Alta del segundo factor (lleva el secreto y los códigos: es la excepción).
    const alta = (await pedir(n, "/api/auth/two-factor/enable", "POST", {}, true)).json() as Alta;
    await pedir(n, "/api/auth/two-factor/verify-totp", "POST", {
      code: codigoDeLaAplicacion(alta.secreto),
    });
    await pedir(n, "/api/auth/estado-de-sesion", "GET");
    await pedir(n, "/api/auth/get-session", "GET");
    // 3. Regenerar los códigos (otra excepción).
    const regenerados = (
      await pedir(n, "/api/auth/two-factor/generate-backup-codes", "POST", {}, true)
    ).json() as { codigosDeRecuperacion: string[] };
    // 4. Segunda sesión: códigos malos hasta el bloqueo, y recuperación mientras está bloqueado.
    const segunda = new Navegador();
    const otraRuta = new URL(
      proveedor.autorizar(
        (
          (
            await segunda.pedir(p.autenticacion, HOST, "POST", "/api/auth/sign-in/social", {
              cuerpo: { provider: "google", callbackURL: "/" },
            })
          ).json() as { url: string }
        ).url,
        admin,
      ),
    );
    await segunda.pedir(p.autenticacion, HOST, "GET", `${otraRuta.pathname}${otraRuta.search}`);
    for (let i = 0; i < 6; i++) {
      const r = await otroNavegadorConLaSesion(segunda, HOST).pedir(
        p.autenticacion,
        HOST,
        "POST",
        "/api/auth/two-factor/verify-totp",
        {
          cuerpo: { code: "000000" },
        },
      );
      registrar("POST verify-totp (malo)", r);
    }
    const bloqueada = await otroNavegadorConLaSesion(segunda, HOST).pedir(
      p.autenticacion,
      HOST,
      "POST",
      "/api/auth/two-factor/verify-backup-code",
      {
        cuerpo: { code: regenerados.codigosDeRecuperacion[0] as string },
      },
    );
    registrar("POST verify-backup-code (bloqueado)", bloqueada);
    // 5. Un cuerpo malo, una ruta cerrada y el cierre de sesión.
    await pedir(n, "/api/auth/two-factor/verify-totp", "POST", {
      code: "123456",
      trustDevice: true,
    });
    await pedir(n, "/api/auth/two-factor/get-totp-uri", "POST", {});
    await pedir(n, "/api/auth/sign-out", "POST", {});
    // 6. Un ingreso de quien no es personal y un cuerpo con un idToken.
    const intruso = new Navegador();
    const r6 = await intruso.ingresarConGoogle(p.autenticacion, HOST, proveedor, perfilAlAzar());
    registrar("GET callback (no personal)", r6);
    registrar("POST sign-in/social (idToken)", await pedirSinGuardar(intruso));

    async function pedirSinGuardar(x: Navegador) {
      return x.pedir(p.autenticacion, HOST, "POST", "/api/auth/sign-in/social", {
        cuerpo: { provider: "google", idToken: { token: "t" } },
      });
    }

    // ---- Los centinelas --------------------------------------------------------------------------------------------
    const tokens = (
      await dueno.query<{ token: string }>(`select token from autenticacion.session`)
    ).rows.map((x) => x.token);
    const delProveedor = proveedor.tokensEntregados();
    const crudo = decodificarBase32(alta.secreto);
    const direccion = `otpauth://totp/ZuluHub%20Plataforma:${encodeURIComponent(admin.email)}?secret=${alta.secreto}`;
    const secretos: Record<string, string> = {
      "secreto de la librería": p.secreto,
      "secreto de Google": proveedor.clientSecret,
      "secreto TOTP (base32)": alta.secreto,
      "secreto TOTP (bytes)": crudo,
      "dirección otpauth": "otpauth://",
      "parámetro secret=": `secret=${alta.secreto}`,
    };
    alta.codigosDeRecuperacion.forEach((c, i) => (secretos[`código de recuperación ${i}`] = c));
    regenerados.codigosDeRecuperacion.forEach((c, i) => (secretos[`código regenerado ${i}`] = c));
    tokens.forEach((t, i) => (secretos[`token de sesión ${i}`] = t));
    delProveedor.forEach((t, i) => (secretos[`token de Google ${i}`] = t));
    expect(direccion.length).toBeGreaterThan(0);
    expect(tokens.length).toBeGreaterThan(0);
    expect(delProveedor.length).toBeGreaterThan(0);

    // (a) Respuestas: ninguna lleva un centinela, salvo el alta y los códigos regenerados, que llevan SU propio secreto.
    for (const v of vistas) {
      const lo_que_lleva = `${v.texto}\n${v.cabeceras}`;
      for (const [nombre, valor] of Object.entries(secretos)) {
        if (
          v.esAlta &&
          /secreto TOTP|código de recuperación|código regenerado|otpauth|secret=/.test(nombre)
        )
          continue;
        // El token de sesión viaja en la cabecera Set-Cookie FIRMADO (es la cookie `HttpOnly` que lo transporta): se mira
        // el texto, no ese encabezado.
        if (/token de sesión/.test(nombre)) {
          expect(v.texto, `${v.ruta}: ${nombre} en el cuerpo`).not.toContain(valor);
          continue;
        }
        expect(lo_que_lleva, `${v.ruta}: ${nombre}`).not.toContain(valor);
      }
      // Y en NINGUNA respuesta sale el usuario completo (email) salvo que se lo mande el propio navegador (no hay).
      expect(v.texto, v.ruta).not.toContain(admin.email);
    }
    // El alta SÍ lleva el secreto y los diez códigos; y los regenerados sus diez.
    const deAlta = vistas.find((v) => v.esAlta && v.ruta.includes("enable"));
    expect(deAlta?.texto).toContain(alta.secreto);
    for (const c of alta.codigosDeRecuperacion) expect(deAlta?.texto).toContain(c);
    expect(deAlta?.texto).not.toContain("otpauth");
    // (b) Registro del servidor.
    const registro = p.registros.join("\n");
    for (const [nombre, valor] of Object.entries(secretos)) {
      expect(registro, `registro: ${nombre}`).not.toContain(valor);
    }
    expect(registro).not.toContain(admin.email);
    // (c) Auditoría (de plataforma y de empresa) y toda la base en claro.
    const auditoria = (
      await dueno.query<{ x: string }>(
        `select to_jsonb(a)::text as x from auditoria_plataforma a union all select to_jsonb(e)::text from auditoria_empresa e`,
      )
    ).rows
      .map((f) => f.x)
      .join("\n");
    for (const [nombre, valor] of Object.entries(secretos)) {
      expect(auditoria, `auditoría: ${nombre}`).not.toContain(valor);
    }
    expect(auditoria).not.toContain(admin.email);
    const esquema = (
      await dueno.query<{ t: string }>(
        `select c.relname as t from pg_class c where c.relnamespace = 'autenticacion'::regnamespace and c.relkind = 'r'`,
      )
    ).rows;
    for (const { t } of esquema) {
      const filas = (
        await dueno.query<{ x: string }>(
          `select to_jsonb(t)::text as x from autenticacion."${t}" t`,
        )
      ).rows
        .map((f) => f.x)
        .join("\n");
      for (const [nombre, valor] of Object.entries(secretos)) {
        // Los tokens de sesión SON la columna `token` de su tabla (la cookie lleva el token firmado, la base el valor); y
        // los de Google se guardan CIFRADOS (otra prueba): acá se mira que ningún secreto de ESTAS clases esté en claro.
        if (t === "session" && /token de sesión/.test(nombre)) continue;
        expect(filas, `autenticacion.${t}: ${nombre}`).not.toContain(valor);
      }
    }
  });
});
