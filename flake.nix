{
  description = "MedSearch — static site generator for Belgium's SAM v2 medication database";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
      in
      {
        # Development shell — for iterating on templates, CSS, generator code
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            bun
            postgresql_16
            pagefind
            curl
            unzip
          ];

          shellHook = ''
            echo "MedSearch build environment"
            echo "  bun:      $(bun --version)"
            echo "  psql:     $(psql --version | head -1)"
            echo "  pagefind: $(pagefind --version)"
            echo ""
            echo "Commands:"
            echo "  ./build.sh              Full pipeline: fetch SAM → PG → generate → pagefind"
            echo "  ./build.sh --skip-fetch  Use existing SAM XML in data/sam-export/"
            echo "  bun run generate         Generate only (needs running PG with data)"
            echo "  pagefind --site dist     Build search index only"
          '';
        };

        # Full build derivation
        # Input: SAM XML files in data/sam-export/ (pre-downloaded)
        # Output: complete static site ready for deployment
        packages.default = pkgs.stdenv.mkDerivation {
          name = "medsearch-static";
          src = ./.;

          nativeBuildInputs = with pkgs; [
            bun
            postgresql_16
            pagefind
          ];

          # Nix builds are sandboxed (no network). SAM XML must be present in src.
          # Run ./fetch-sam.sh before nix build to download the latest export.

          buildPhase = ''
            export HOME=$TMPDIR
            export PGDATA=$TMPDIR/pgdata
            export PGHOST=$TMPDIR
            export PGPORT=5433
            export DATABASE_URL="postgresql://localhost:$PGPORT/medsearch"

            echo "=== Setting up temporary PostgreSQL ==="
            initdb -D $PGDATA --no-locale --encoding=UTF8 -U postgres
            # Listen on unix socket only (no TCP needed)
            echo "unix_socket_directories = '$TMPDIR'" >> $PGDATA/postgresql.conf
            echo "listen_addresses = '''" >> $PGDATA/postgresql.conf
            echo "port = $PGPORT" >> $PGDATA/postgresql.conf
            pg_ctl -D $PGDATA -l $TMPDIR/pg.log start

            echo "=== Creating database and loading schema ==="
            createdb -h $TMPDIR -p $PGPORT -U postgres medsearch
            psql -h $TMPDIR -p $PGPORT -U postgres -d medsearch -f scripts/schema.sql

            echo "=== Importing SAM XML data ==="
            DATABASE_URL="postgresql://postgres@localhost:$PGPORT/medsearch?host=$TMPDIR" \
              bun run scripts/sync-sam-database.ts --skip-download --verbose

            echo "=== Generating static HTML ==="
            DATABASE_URL="postgresql://postgres@localhost:$PGPORT/medsearch?host=$TMPDIR" \
              bun run generator/index.ts

            echo "=== Building search index ==="
            ionice -c 3 nice -n 15 pagefind --site dist --output-subdir _search

            echo "=== Stopping PostgreSQL ==="
            pg_ctl -D $PGDATA stop
          '';

          installPhase = ''
            cp -r dist $out
          '';
        };
      }
    );
}
