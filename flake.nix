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
        resourceLimit = cmd:
          "ionice -c 3 nice -n 15 ${cmd}";

        # SAM v2 export — update these when a new version is published
        samVersion = "11798";
        samHash = "sha256-DheLGmSpg5+XZntHLvyvmfmJ/DmruG4cMy1WY3gKiLo=";

        samExport = pkgs.fetchzip {
          url = "https://www.vas.ehealth.fgov.be/websamcivics/samcivics/download/samv2-download?type=FULL&xsd=5&version=${samVersion}";
          hash = samHash;
          stripRoot = false;
          extension = "zip";
        };
      in
      {
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [ bun pagefind curl unzip util-linux ];
          shellHook = ''
            echo "MedSearch build environment"
            echo ""
            echo "  nix build .#database   SAM XML → SQLite"
            echo "  nix build .#html       SQLite → HTML pages"
            echo "  nix build .#site       HTML → HTML + search index"
            echo "  nix build              Full pipeline"
            echo "  nix develop            This shell"
            echo "  nix run .#update-sam   Check for new SAM version"
          '';
        };

        packages = {
          # Step 1: SAM XML → SQLite database
          database = pkgs.stdenv.mkDerivation {
            name = "medsearch-database";
            src = ./.;
            nativeBuildInputs = [ pkgs.bun ];
            buildPhase = ''
              export HOME=$TMPDIR
              export DB_PATH=$TMPDIR/medsearch.sqlite
              mkdir -p data
              ln -s ${samExport} data/sam-export
              bun run scripts/sync-sam-database.ts --skip-download --verbose
            '';
            installPhase = "cp $TMPDIR/medsearch.sqlite $out";
          };

          # Step 2: SQLite → HTML pages
          html = pkgs.stdenv.mkDerivation {
            name = "medsearch-html";
            src = ./.;
            nativeBuildInputs = [ pkgs.bun ];
            buildPhase = ''
              export HOME=$TMPDIR
              export DB_PATH=${self.packages.${system}.database}
              bun run generator/index.ts
            '';
            installPhase = "cp -r dist $out";
          };

          # Step 3: HTML → HTML + Pagefind search index
          site = pkgs.stdenv.mkDerivation {
            name = "medsearch-site";
            src = self.packages.${system}.html;
            nativeBuildInputs = with pkgs; [ pagefind util-linux ];
            buildPhase = ''
              cp -r $src site && chmod -R u+w site
              ${resourceLimit "pagefind --site site --output-subdir _search"}
            '';
            installPhase = "cp -r site $out";
          };

          default = self.packages.${system}.site;
        };

        # Helper to check for new SAM versions
        apps.update-sam = {
          type = "app";
          program = "${pkgs.writeShellApplication {
            name = "update-sam";
            runtimeInputs = [ pkgs.curl ];
            text = ''
              CURRENT="${samVersion}"
              LATEST=$(curl -sL "https://www.vas.ehealth.fgov.be/websamcivics/samcivics/download/samv2-full-getLastVersion?xsd=5" --max-time 15)

              if ! [[ "$LATEST" =~ ^[0-9]+$ ]]; then
                echo "ERROR: Could not determine latest version. Got: $LATEST"
                exit 1
              fi

              if [ "$CURRENT" = "$LATEST" ]; then
                echo "Already on latest SAM version: $CURRENT"
              else
                echo "New SAM version available!"
                echo "  Current: $CURRENT"
                echo "  Latest:  $LATEST"
                echo ""
                echo "Update samVersion in flake.nix to \"$LATEST\","
                echo "set samHash to \"\" and run nix build .#database to get the new hash."
              fi
            '';
          }}/bin/update-sam";
        };
      }
    );
}
