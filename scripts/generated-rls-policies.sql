-- === ALTER Propyte_desarrolladores + ext_publicado + ext_destacado ===
ALTER TABLE real_estate_hub."Propyte_desarrolladores"
        ADD COLUMN IF NOT EXISTS ext_publicado boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS ext_destacado boolean NOT NULL DEFAULT false;

-- === ALTER Propyte_historial_precios + ext_publicado + ext_destacado ===
ALTER TABLE real_estate_hub."Propyte_historial_precios"
        ADD COLUMN IF NOT EXISTS ext_publicado boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS ext_destacado boolean NOT NULL DEFAULT false;

-- === ALTER Propyte_resenas + ext_publicado + ext_destacado ===
ALTER TABLE real_estate_hub."Propyte_resenas"
        ADD COLUMN IF NOT EXISTS ext_publicado boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS ext_destacado boolean NOT NULL DEFAULT false;

-- === ALTER Propyte_unidades + ext_destacado ===
ALTER TABLE real_estate_hub."Propyte_unidades"
        ADD COLUMN IF NOT EXISTS ext_destacado boolean NOT NULL DEFAULT false;

-- === ENABLE RLS Propyte_desarrolladores ===
ALTER TABLE real_estate_hub."Propyte_desarrolladores" ENABLE ROW LEVEL SECURITY;

-- === DROP existing policies Propyte_desarrolladores ===
DO $$
          DECLARE p record;
          BEGIN
            FOR p IN SELECT policyname FROM pg_policies
                     WHERE schemaname='real_estate_hub' AND tablename='Propyte_desarrolladores'
            LOOP
              EXECUTE format('DROP POLICY IF EXISTS %I ON real_estate_hub.%I', p.policyname, 'Propyte_desarrolladores');
            END LOOP;
          END $$;

-- === ENABLE RLS Propyte_desarrollos ===
ALTER TABLE real_estate_hub."Propyte_desarrollos" ENABLE ROW LEVEL SECURITY;

-- === DROP existing policies Propyte_desarrollos ===
DO $$
          DECLARE p record;
          BEGIN
            FOR p IN SELECT policyname FROM pg_policies
                     WHERE schemaname='real_estate_hub' AND tablename='Propyte_desarrollos'
            LOOP
              EXECUTE format('DROP POLICY IF EXISTS %I ON real_estate_hub.%I', p.policyname, 'Propyte_desarrollos');
            END LOOP;
          END $$;

-- === ENABLE RLS Propyte_unidades ===
ALTER TABLE real_estate_hub."Propyte_unidades" ENABLE ROW LEVEL SECURITY;

-- === DROP existing policies Propyte_unidades ===
DO $$
          DECLARE p record;
          BEGIN
            FOR p IN SELECT policyname FROM pg_policies
                     WHERE schemaname='real_estate_hub' AND tablename='Propyte_unidades'
            LOOP
              EXECUTE format('DROP POLICY IF EXISTS %I ON real_estate_hub.%I', p.policyname, 'Propyte_unidades');
            END LOOP;
          END $$;

-- === ENABLE RLS Propyte_historial_precios ===
ALTER TABLE real_estate_hub."Propyte_historial_precios" ENABLE ROW LEVEL SECURITY;

-- === DROP existing policies Propyte_historial_precios ===
DO $$
          DECLARE p record;
          BEGIN
            FOR p IN SELECT policyname FROM pg_policies
                     WHERE schemaname='real_estate_hub' AND tablename='Propyte_historial_precios'
            LOOP
              EXECUTE format('DROP POLICY IF EXISTS %I ON real_estate_hub.%I', p.policyname, 'Propyte_historial_precios');
            END LOOP;
          END $$;

-- === ENABLE RLS Propyte_resenas ===
ALTER TABLE real_estate_hub."Propyte_resenas" ENABLE ROW LEVEL SECURITY;

-- === DROP existing policies Propyte_resenas ===
DO $$
          DECLARE p record;
          BEGIN
            FOR p IN SELECT policyname FROM pg_policies
                     WHERE schemaname='real_estate_hub' AND tablename='Propyte_resenas'
            LOOP
              EXECUTE format('DROP POLICY IF EXISTS %I ON real_estate_hub.%I', p.policyname, 'Propyte_resenas');
            END LOOP;
          END $$;

-- === ENABLE RLS Propyte_zoho_leads ===
ALTER TABLE real_estate_hub."Propyte_zoho_leads" ENABLE ROW LEVEL SECURITY;

-- === DROP existing policies Propyte_zoho_leads ===
DO $$
          DECLARE p record;
          BEGIN
            FOR p IN SELECT policyname FROM pg_policies
                     WHERE schemaname='real_estate_hub' AND tablename='Propyte_zoho_leads'
            LOOP
              EXECUTE format('DROP POLICY IF EXISTS %I ON real_estate_hub.%I', p.policyname, 'Propyte_zoho_leads');
            END LOOP;
          END $$;

-- === ENABLE RLS Propyte_zoho_accounts ===
ALTER TABLE real_estate_hub."Propyte_zoho_accounts" ENABLE ROW LEVEL SECURITY;

-- === DROP existing policies Propyte_zoho_accounts ===
DO $$
          DECLARE p record;
          BEGIN
            FOR p IN SELECT policyname FROM pg_policies
                     WHERE schemaname='real_estate_hub' AND tablename='Propyte_zoho_accounts'
            LOOP
              EXECUTE format('DROP POLICY IF EXISTS %I ON real_estate_hub.%I', p.policyname, 'Propyte_zoho_accounts');
            END LOOP;
          END $$;

-- === ENABLE RLS Propyte_zoho_contacts ===
ALTER TABLE real_estate_hub."Propyte_zoho_contacts" ENABLE ROW LEVEL SECURITY;

-- === DROP existing policies Propyte_zoho_contacts ===
DO $$
          DECLARE p record;
          BEGIN
            FOR p IN SELECT policyname FROM pg_policies
                     WHERE schemaname='real_estate_hub' AND tablename='Propyte_zoho_contacts'
            LOOP
              EXECUTE format('DROP POLICY IF EXISTS %I ON real_estate_hub.%I', p.policyname, 'Propyte_zoho_contacts');
            END LOOP;
          END $$;

-- === ENABLE RLS Propyte_zoho_deals ===
ALTER TABLE real_estate_hub."Propyte_zoho_deals" ENABLE ROW LEVEL SECURITY;

-- === DROP existing policies Propyte_zoho_deals ===
DO $$
          DECLARE p record;
          BEGIN
            FOR p IN SELECT policyname FROM pg_policies
                     WHERE schemaname='real_estate_hub' AND tablename='Propyte_zoho_deals'
            LOOP
              EXECUTE format('DROP POLICY IF EXISTS %I ON real_estate_hub.%I', p.policyname, 'Propyte_zoho_deals');
            END LOOP;
          END $$;

-- === ENABLE RLS Propyte_zoho_id_map ===
ALTER TABLE real_estate_hub."Propyte_zoho_id_map" ENABLE ROW LEVEL SECURITY;

-- === DROP existing policies Propyte_zoho_id_map ===
DO $$
          DECLARE p record;
          BEGIN
            FOR p IN SELECT policyname FROM pg_policies
                     WHERE schemaname='real_estate_hub' AND tablename='Propyte_zoho_id_map'
            LOOP
              EXECUTE format('DROP POLICY IF EXISTS %I ON real_estate_hub.%I', p.policyname, 'Propyte_zoho_id_map');
            END LOOP;
          END $$;

-- === POLICY select_published on Propyte_desarrolladores ===
CREATE POLICY "select_published" ON real_estate_hub."Propyte_desarrolladores"
          FOR SELECT TO anon, authenticated
          USING (ext_publicado = true AND deleted_at IS NULL);

-- === POLICY select_published on Propyte_desarrollos ===
CREATE POLICY "select_published" ON real_estate_hub."Propyte_desarrollos"
          FOR SELECT TO anon, authenticated
          USING (ext_publicado = true AND deleted_at IS NULL);

-- === POLICY select_published on Propyte_unidades ===
CREATE POLICY "select_published" ON real_estate_hub."Propyte_unidades"
          FOR SELECT TO anon, authenticated
          USING (ext_publicado = true AND deleted_at IS NULL);

-- === POLICY select_published on Propyte_historial_precios ===
CREATE POLICY "select_published" ON real_estate_hub."Propyte_historial_precios"
        FOR SELECT TO anon, authenticated
        USING (ext_publicado = true);

-- === POLICY select_verified_published on Propyte_resenas ===
CREATE POLICY "select_verified_published" ON real_estate_hub."Propyte_resenas"
        FOR SELECT TO anon, authenticated
        USING (verificada = true AND ext_publicado = true);

-- === ALTER VIEW v_developers security_invoker ===
ALTER VIEW real_estate_hub."v_developers" SET (security_invoker = true);

-- === GRANT SELECT on v_developers ===
GRANT SELECT ON real_estate_hub."v_developers" TO anon, authenticated;

-- === ALTER VIEW v_developments security_invoker ===
ALTER VIEW real_estate_hub."v_developments" SET (security_invoker = true);

-- === GRANT SELECT on v_developments ===
GRANT SELECT ON real_estate_hub."v_developments" TO anon, authenticated;

-- === ALTER VIEW v_units security_invoker ===
ALTER VIEW real_estate_hub."v_units" SET (security_invoker = true);

-- === GRANT SELECT on v_units ===
GRANT SELECT ON real_estate_hub."v_units" TO anon, authenticated;
