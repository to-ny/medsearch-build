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
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            bun
            pagefind
            curl
            unzip
          ];

          shellHook = ''
            echo "MedSearch build environment"
            echo "  bun:      $(bun --version)"
            echo "  pagefind: $(pagefind --version)"
            echo ""
            echo "Commands:"
            echo "  ./build.sh              Full pipeline: fetch SAM → import → generate → pagefind"
            echo "  ./build.sh --skip-fetch  Use existing SAM XML in data/sam-export/"
            echo "  ./build.sh --skip-import Use existing SQLite database"
          '';
        };

        packages.default = pkgs.stdenv.mkDerivation {
          name = "medsearch-static";
          src = ./.;

          nativeBuildInputs = with pkgs; [
            bun
            pagefind
          ];

          # SAM XML must be present in data/sam-export/ before nix build.
          # Run ./fetch-sam.sh first.
          buildPhase = ''
            export HOME=$TMPDIR
            export DB_PATH=$TMPDIR/medsearch.sqlite

            echo "=== Importing SAM XML into SQLite ==="
            bun run scripts/sync-sam-database.ts --skip-download --verbose

            echo "=== Generating static HTML ==="
            bun run generator/index.ts

            echo "=== Building search index ==="
            ionice -c 3 nice -n 15 pagefind --site dist --output-subdir _search
          '';

          installPhase = ''
            cp -r dist $out
          '';
        };
      }
    );
}
